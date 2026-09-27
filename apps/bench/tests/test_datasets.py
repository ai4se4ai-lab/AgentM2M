"""Tests for dataset normalization logic.

Uses a recorded real fixture (two rows fetched live from
`princeton-nlp/SWE-bench_Lite`, see tests/fixtures/lite_raw_sample.json and
conftest.lite_raw_sample) rather than hitting the network on every test run.
One slow/network test at the bottom actually calls `datasets.load_dataset`
for real and is skippable when offline.
"""

from __future__ import annotations

import json

import pytest

from app.datasets.common import normalize_row, persist_instances, load_persisted_instances, _as_list
from app.datasets import swebench_lite


def test_as_list_parses_json_encoded_string():
    raw = '["a::test_one", "a::test_two"]'
    assert _as_list(raw) == ["a::test_one", "a::test_two"]


def test_as_list_passes_through_real_list():
    assert _as_list(["x", "y"]) == ["x", "y"]


def test_as_list_handles_none_and_empty():
    assert _as_list(None) == []
    assert _as_list("") == []


def test_normalize_row_on_real_fixture(lite_raw_sample):
    row = next(r for r in lite_raw_sample if r["instance_id"] == "psf__requests-1963")
    inst = normalize_row(row, "lite", extra_keys=["hints_text", "version"])

    assert inst.instance_id == "psf__requests-1963"
    assert inst.repo == "psf/requests"
    assert inst.base_commit  # real commit sha, non-empty
    assert inst.problem_statement.strip() != ""
    assert inst.patch.strip().startswith("diff") or "---" in inst.patch
    assert isinstance(inst.fail_to_pass, list) and len(inst.fail_to_pass) > 0
    assert isinstance(inst.pass_to_pass, list) and len(inst.pass_to_pass) > 0
    assert inst.dataset == "lite"
    assert "version" in inst.extra


def test_normalize_row_all_required_fields_present_for_every_fixture_row(lite_raw_sample):
    for row in lite_raw_sample:
        inst = normalize_row(row, "lite")
        d = inst.to_dict()
        for field in ("instance_id", "repo", "base_commit", "problem_statement", "patch",
                      "test_patch", "FAIL_TO_PASS", "PASS_TO_PASS"):
            assert field in d, f"missing {field} for {row['instance_id']}"
            assert d[field] not in (None, ""), f"{field} empty for {row['instance_id']}"


def test_persist_and_load_roundtrip(isolated_data_dir, lite_raw_sample):
    instances = [normalize_row(row, "lite") for row in lite_raw_sample]
    path = persist_instances("lite", instances)
    assert path.exists()

    loaded = load_persisted_instances("lite")
    assert len(loaded) == len(instances)
    ids = {rec["instance_id"] for rec in loaded}
    assert ids == {"psf__requests-1963", "pallets__flask-4045"}


def test_load_persisted_instances_empty_when_never_fetched(isolated_data_dir):
    assert load_persisted_instances("verified") == []


def test_lite_s_filter_mechanism_is_real(monkeypatch, lite_raw_sample):
    """Lite-S must actually exclude ids present in the flagged set -- proves
    the *mechanism* works even though the real Agentless exclusion list
    wasn't sourced in this pass (see swebench_lite.py's module docstring)."""
    from app.datasets import common as common_mod

    def fake_fetch_lite(limit=None):
        return [common_mod.normalize_row(row, "lite") for row in lite_raw_sample]

    monkeypatch.setattr(swebench_lite, "fetch_lite", fake_fetch_lite)
    monkeypatch.setattr(swebench_lite, "AGENTLESS_FLAGGED_INSTANCE_IDS", {"psf__requests-1963"})

    filtered = swebench_lite.fetch_lite_s()
    ids = {i.instance_id for i in filtered}
    assert "psf__requests-1963" not in ids
    assert "pallets__flask-4045" in ids
    assert all(i.dataset == "lite-s" for i in filtered)


@pytest.mark.slow
def test_real_fetch_lite_returns_300_instances():
    """Actually hits HuggingFace. Confirms the real dataset fetch this
    service is supposed to perform still returns the documented count."""
    instances = swebench_lite.fetch_lite()
    assert len(instances) == 300
    ids = {i.instance_id for i in instances}
    assert "astropy__astropy-12907" in ids


@pytest.mark.slow
def test_real_fetch_verified_returns_500_instances():
    from app.datasets import swebench_verified

    instances = swebench_verified.fetch_verified()
    assert len(instances) == 500
