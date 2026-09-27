"""FastAPI route tests via TestClient.

Every test uses `isolated_data_dir` so persisted dataset files never touch
the real apps/bench/data/ this session's real fetches wrote to, and a fresh
`app.main` is imported inside each test (see conftest.py) so it picks up the
isolated paths. Docker execution itself is monkeypatched out for the
general route tests (that's covered for real in test_harness.py); one
network-touching test is marked `slow`.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


def _client():
    from app.main import app

    return TestClient(app)


def test_health(isolated_data_dir):
    client = _client()
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert isinstance(body["docker_available"], bool)


def test_benchmarks_lists_five_datasets_none_available_initially(isolated_data_dir):
    client = _client()
    resp = client.get("/api/benchmarks")
    assert resp.status_code == 200
    body = resp.json()
    names = {b["name"] for b in body}
    assert names == {"lite", "lite-s", "verified", "live", "pro"}
    for b in body:
        assert b["available"] is False
        assert b["instanceCount"] is None
    live = next(b for b in body if b["name"] == "live")
    assert live["dockerExecutionSupported"] is False
    assert "not wired up" in live["note"] or "builder" in live["note"]


def test_fetch_unknown_dataset_404(isolated_data_dir):
    client = _client()
    resp = client.post("/api/benchmarks/nonexistent/fetch", json={})
    assert resp.status_code == 404


def test_fetch_lite_persists_and_reflects_in_benchmarks_list(isolated_data_dir, monkeypatch, lite_raw_sample):
    from app.datasets import swebench_lite as lite_mod
    from app.datasets.common import normalize_row

    def fake_fetch_lite(limit=None):
        rows = lite_raw_sample if limit is None else lite_raw_sample[:limit]
        return [normalize_row(r, "lite") for r in rows]

    monkeypatch.setattr(lite_mod, "fetch_lite", fake_fetch_lite)

    client = _client()
    resp = client.post("/api/benchmarks/lite/fetch", json={"limit": 2})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 2
    assert {i["instance_id"] for i in body["instances"]} == {"psf__requests-1963", "pallets__flask-4045"}

    listing = client.get("/api/benchmarks").json()
    lite_entry = next(b for b in listing if b["name"] == "lite")
    assert lite_entry["available"] is True
    assert lite_entry["instanceCount"] == 2


def test_instances_empty_before_fetch(isolated_data_dir):
    client = _client()
    resp = client.get("/api/benchmarks/verified/instances")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 0
    assert body["instances"] == []


def test_instances_summary_after_fetch(isolated_data_dir, monkeypatch, lite_raw_sample):
    from app.datasets import swebench_lite as lite_mod
    from app.datasets.common import normalize_row

    monkeypatch.setattr(
        lite_mod, "fetch_lite",
        lambda limit=None: [normalize_row(r, "lite") for r in lite_raw_sample],
    )
    client = _client()
    client.post("/api/benchmarks/lite/fetch", json={})
    resp = client.get("/api/benchmarks/lite/instances")
    body = resp.json()
    assert body["count"] == 2
    row = next(i for i in body["instances"] if i["instance_id"] == "psf__requests-1963")
    assert row["repo"] == "psf/requests"
    assert row["num_fail_to_pass"] > 0
    assert row["num_pass_to_pass"] > 0


def test_run_requires_fetch_first(isolated_data_dir):
    client = _client()
    resp = client.post("/api/benchmarks/run", json={"dataset": "lite", "baseline": "gold"})
    assert resp.status_code == 400
    assert "fetch" in resp.json()["detail"]


def test_run_unknown_dataset_404(isolated_data_dir):
    client = _client()
    resp = client.post("/api/benchmarks/run", json={"dataset": "nope", "baseline": "gold"})
    assert resp.status_code == 404


def test_run_unknown_baseline_rejected_by_schema(isolated_data_dir, monkeypatch, lite_raw_sample):
    from app.datasets import swebench_lite as lite_mod
    from app.datasets.common import normalize_row

    monkeypatch.setattr(
        lite_mod, "fetch_lite",
        lambda limit=None: [normalize_row(r, "lite") for r in lite_raw_sample],
    )
    client = _client()
    client.post("/api/benchmarks/lite/fetch", json={})
    resp = client.post("/api/benchmarks/run", json={"dataset": "lite", "baseline": "bogus"})
    assert resp.status_code == 422  # pydantic Literal validation


def test_run_calls_harness_and_returns_results(isolated_data_dir, monkeypatch, lite_raw_sample):
    """Route wiring test: the Docker call itself is stubbed (real Docker
    execution is covered end-to-end in test_harness.py) so this stays fast
    while proving /api/benchmarks/run resolves instance ids from the
    persisted dataset and forwards them to the harness correctly."""
    from app.datasets import swebench_lite as lite_mod
    from app.datasets.common import normalize_row
    import app.main as main_mod

    monkeypatch.setattr(
        lite_mod, "fetch_lite",
        lambda limit=None: [normalize_row(r, "lite") for r in lite_raw_sample],
    )
    client = _client()
    client.post("/api/benchmarks/lite/fetch", json={})

    captured = {}

    def fake_run_baseline(dataset, instance_ids, baseline, run_id=None, timeout=900):
        captured["args"] = (dataset, instance_ids, baseline)
        return {iid: {"status": "ran", "resolved": True} for iid in instance_ids}

    monkeypatch.setattr(main_mod, "run_baseline", fake_run_baseline)

    resp = client.post("/api/benchmarks/run", json={"dataset": "lite", "baseline": "gold", "limit": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["dataset"] == "lite"
    assert body["baseline"] == "gold"
    assert len(body["instanceIds"]) == 1
    assert captured["args"][2] == "gold"


def test_rq1_not_computed_when_no_aggregate(isolated_data_dir, tmp_path, monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "RQ1_RESULTS_DIR", tmp_path / "rq1_empty")
    client = _client()
    resp = client.get("/api/evaluation/rq1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["computed"] is False
    assert "note" in body


def test_rq1_computed_reads_real_aggregate_file(isolated_data_dir, tmp_path, monkeypatch):
    import app.main as main_mod

    results_dir = tmp_path / "rq1_results"
    results_dir.mkdir()
    fake_aggregate = {"dataset": "lite", "baselines": {"gold": {"resolve_rate": 1.0}}}
    (results_dir / "aggregate.json").write_text(json.dumps(fake_aggregate))
    monkeypatch.setattr(main_mod, "RQ1_RESULTS_DIR", results_dir)

    client = _client()
    resp = client.get("/api/evaluation/rq1")
    body = resp.json()
    assert body["computed"] is True
    assert body["dataset"] == "lite"
    assert body["baselines"]["gold"]["resolve_rate"] == 1.0


def test_rq3_not_computed_when_no_aggregate(isolated_data_dir, tmp_path, monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "RQ3_RESULTS_DIR", tmp_path / "rq3_empty")
    client = _client()
    body = client.get("/api/evaluation/rq3").json()
    assert body["computed"] is False


def test_hypotheses_seven_items_all_honestly_not_evaluated(isolated_data_dir):
    client = _client()
    resp = client.get("/api/evaluation/hypotheses")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 7
    ids = {h["id"] for h in body}
    assert ids == {f"H{i}" for i in range(1, 8)}
    for h in body:
        assert h["status"] == "not_evaluated_at_scale"
        assert h["note"]


@pytest.mark.slow
def test_real_fetch_lite_via_api(isolated_data_dir):
    """Actually hits HuggingFace through the API layer end to end."""
    client = _client()
    resp = client.post("/api/benchmarks/lite/fetch", json={"limit": 5})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 5
