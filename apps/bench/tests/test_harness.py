"""Tests for the patch-apply validation helper and the real Docker harness.

The `docker` -marked test at the bottom actually drives the Docker daemon
and runs a real, pre-pulled SWE-bench Lite instance container end to end
(gold-patch baseline). It is marked so it can be skipped in environments
without Docker, but per the task brief it MUST run and pass here.
"""

from __future__ import annotations

import pytest

from app.harness.patch_apply import (
    InvalidPatchError,
    count_changed_files,
    is_empty_patch,
    validate_unified_diff,
)
from app.harness.docker_runner import BASELINES, harness_supported, run_baseline

REAL_UNIFIED_DIFF = """diff --git a/foo.py b/foo.py
index 123..456 100644
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
-old line
+new line
 unchanged
"""


def test_is_empty_patch():
    assert is_empty_patch("") is True
    assert is_empty_patch(None) is True
    assert is_empty_patch("   \n  ") is True
    assert is_empty_patch(REAL_UNIFIED_DIFF) is False


def test_validate_unified_diff_accepts_real_diff():
    validate_unified_diff(REAL_UNIFIED_DIFF)  # should not raise


def test_validate_unified_diff_rejects_empty():
    with pytest.raises(InvalidPatchError):
        validate_unified_diff("")


def test_validate_unified_diff_rejects_prose():
    with pytest.raises(InvalidPatchError):
        validate_unified_diff("please fix the bug in foo.py, thanks!")


def test_count_changed_files():
    two_file_diff = REAL_UNIFIED_DIFF + (
        "\ndiff --git a/bar.py b/bar.py\n"
        "--- a/bar.py\n+++ b/bar.py\n@@ -1,1 +1,1 @@\n-a\n+b\n"
    )
    assert count_changed_files(REAL_UNIFIED_DIFF) == 1
    assert count_changed_files(two_file_diff) == 2


def test_harness_supported_for_lite_and_verified_not_for_live_or_pro():
    assert harness_supported("lite") is True
    assert harness_supported("lite-s") is True
    assert harness_supported("verified") is True
    assert harness_supported("live") is False
    assert harness_supported("pro") is False


def test_run_baseline_rejects_unknown_baseline():
    with pytest.raises(ValueError):
        run_baseline("lite", ["some-instance"], "not-a-real-baseline")


def test_run_baseline_skips_honestly_for_unsupported_dataset():
    results = run_baseline("live", ["whatever-id"], "gold")
    assert results["whatever-id"]["status"] == "skipped"
    assert "not wired up" in results["whatever-id"]["reason"]


def test_run_baseline_empty_instance_list_returns_empty_dict():
    assert run_baseline("lite", [], "gold") == {}


@pytest.mark.docker
def test_real_docker_run_gold_baseline_resolves_psf_requests_1963():
    """Real end-to-end run: pulls (already cached) the published SWE-bench
    Lite Docker image for psf__requests-1963, applies the dataset's own gold
    patch inside the container, runs its FAIL_TO_PASS/PASS_TO_PASS tests via
    the official swebench harness, and checks the real verdict.

    This is the harness sanity check the task brief asks for: a correct
    patch must be scored resolved. Takes roughly a minute (real container
    lifecycle + real pytest run inside it, under ARM64 QEMU emulation since
    the published images are amd64-only).
    """
    results = run_baseline(
        "lite",
        ["psf__requests-1963"],
        "gold",
        run_id="pytest-docker-gold-requests-1963",
        timeout=600,
    )
    result = results["psf__requests-1963"]
    assert result["status"] == "ran", result
    assert result["resolved"] is True, result
    assert result["patch_successfully_applied"] is True
    f2p = result["tests_status"]["FAIL_TO_PASS"]
    assert f2p["failure"] == []
    assert len(f2p["success"]) > 0
