"""Background-job API: returns at once, progresses, persists, survives a 'restart'."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from app import jobs
from app.main import app


def _wait(client, job_id, want=("completed", "failed", "cancelled"), timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in want:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} stuck: {job}")


def _fake_fetch(monkeypatch, lite_raw_sample):
    from app.datasets import registry, swebench_lite
    from app.datasets.common import normalize_row, persist_instances

    def fake(limit=None):
        inst = [normalize_row(r, "lite") for r in lite_raw_sample][:limit]
        persist_instances("lite", inst)
        return inst

    monkeypatch.setitem(registry.REGISTRY, "lite", registry.REGISTRY["lite"].__class__(**{**registry.REGISTRY["lite"].__dict__, "fetch_and_persist": fake}))


def test_fetch_job_returns_immediately_and_completes(isolated_data_dir, monkeypatch, lite_raw_sample):
    _fake_fetch(monkeypatch, lite_raw_sample)
    client = TestClient(app)
    resp = client.post("/api/jobs/fetch", json={"dataset": "lite"})
    assert resp.status_code == 202
    job = _wait(client, resp.json()["id"])
    assert job["status"] == "completed"
    assert job["summary"]["count"] == len(lite_raw_sample)
    listing = {d["name"]: d for d in client.get("/api/benchmarks").json()}
    assert listing["lite"]["available"] and listing["lite"]["fetchedAt"]


def test_fetch_job_unknown_dataset_404(isolated_data_dir):
    assert TestClient(app).post("/api/jobs/fetch", json={"dataset": "nope"}).status_code == 404


def test_run_job_progress_results_and_summary(isolated_data_dir, monkeypatch, lite_raw_sample):
    _fake_fetch(monkeypatch, lite_raw_sample)
    import app.harness.docker_runner as dr

    def fake_run(dataset, ids, baseline, run_id=None, timeout=900, on_start=None, on_phase=None, on_result=None, should_cancel=None):
        out = {}
        for iid in ids:
            on_start(iid)
            out[iid] = {"status": "ran", "resolved": baseline == "gold", "patch_successfully_applied": True,
                        "duration_s": 1.0, "tests_status": {"FAIL_TO_PASS": {"success": ["a"], "failure": []}}}
            on_result(iid, out[iid])
        return out

    monkeypatch.setattr(dr, "run_baseline", fake_run)
    client = TestClient(app)
    # dataset not fetched yet: the run job fetches it first
    job = _wait(client, client.post("/api/jobs/run", json={"dataset": "lite", "baseline": "gold", "limit": 0}).json()["id"])
    assert job["status"] == "completed"
    assert job["progress"] == {"done": 2, "total": 2, "current": None}
    assert job["summary"]["n_resolved"] == 2 and job["summary"]["resolve_rate"] == 1.0
    assert all(r["FAIL_TO_PASS"] == {"passed": 1, "failed": 0} for r in job["results"].values())
    assert [j["id"] for j in client.get("/api/jobs?kind=run").json()] == [job["id"]]


def test_run_job_on_unsupported_dataset_fails_with_reason(isolated_data_dir):
    client = TestClient(app)
    job = _wait(client, client.post("/api/jobs/run", json={"dataset": "pro", "baseline": "gold"}).json()["id"])
    assert job["status"] == "failed" and "not wired up" in job["error"]


def test_stale_running_jobs_are_marked_interrupted_after_restart(isolated_data_dir):
    d = isolated_data_dir.jobs_dir()
    (d / "run-1.json").write_text(json.dumps({"id": "run-1", "kind": "run", "dataset": "lite", "status": "running",
                                              "createdAt": "2026-01-01T00:00:00+00:00", "results": {}}))
    jobs._loaded_dir = None  # simulate a fresh process
    job = TestClient(app).get("/api/jobs/run-1").json()
    assert job["status"] == "failed" and "restarted" in job["error"]


def test_run_job_where_nothing_executed_is_failed_not_completed(isolated_data_dir, monkeypatch, lite_raw_sample):
    _fake_fetch(monkeypatch, lite_raw_sample)
    import app.harness.docker_runner as dr

    def all_skipped(dataset, ids, baseline, **hooks):
        out = {i: {"status": "skipped", "reason": "image pull failed"} for i in ids}
        for i, r in out.items():
            hooks["on_result"](i, r)
        return out

    monkeypatch.setattr(dr, "run_baseline", all_skipped)
    client = TestClient(app)
    job = _wait(client, client.post("/api/jobs/run", json={"dataset": "lite", "baseline": "gold"}).json()["id"])
    assert job["status"] == "failed" and "image pull failed" in job["error"]
