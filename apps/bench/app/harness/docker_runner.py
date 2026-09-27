"""Real, per-instance Docker execution harness.

This is the executable oracle referenced by docs/dev.md section 8: given one
SWE-bench instance and a candidate patch, apply the patch inside that
instance's real Docker container, run its FAIL_TO_PASS/PASS_TO_PASS tests,
and report pass/fail. Rather than re-implement container lifecycle, patch
application (with its git-apply fallback chain), log parsing per repo, and
test-status grading, this drives the official `swebench` PyPI package's
harness functions directly (`swebench.harness.run_evaluation.run_instance`,
`swebench.harness.utils.make_test_spec`) -- the same machinery that produces
published SWE-bench leaderboard numbers.

Two honest, load-bearing facts about this environment, discovered while
building this:

1. This host is aarch64 (ARM64). SWE-bench's published instance images are
   amd64-only. Running them here requires QEMU user-mode emulation
   registered with the kernel's binfmt_misc (`docker run --privileged --rm
   tonistiigi/binfmt --install all`), done once for this environment. Images
   are then pulled with `docker pull --platform linux/amd64 <image>` and run
   normally -- Docker/containerd transparently execute them under emulation.
   This works (verified) but is slower than native amd64 execution.
2. Only SWE-bench Lite and Verified have a harness-ready HuggingFace mirror
   (`SWE-bench/SWE-bench_Lite`, `SWE-bench/SWE-bench_Verified`) carrying the
   pre-built `image`/`eval_script`/`log_parser`/`eval_type` fields
   `make_test_spec` needs. SWE-bench-Live and SWE-Bench Pro are NOT wired up
   for Docker execution in this pass (see their dataset fetchers for why);
   `run_baseline` reports "skipped" for them rather than pretending to run.
"""

from __future__ import annotations

import contextlib
import os
import time
from pathlib import Path
from typing import Any, Callable

from app import config as _config

# Looked up as `_config.RUNS_DIR` (not imported by name) so that patching
# app.config.RUNS_DIR (e.g. tests isolating where run artifacts land) is
# picked up here too -- a plain `from app.config import RUNS_DIR` would
# freeze the value at import time instead.

# Harness-ready dataset ids (carry image/eval_script/log_parser/eval_type),
# distinct from the princeton-nlp ids our fetchers persist metadata from.
HARNESS_DATASET_MAP = {
    "lite": "SWE-bench/SWE-bench_Lite",
    # Lite-S is a metadata-level filter over Lite's instance ids (see
    # app/datasets/swebench_lite.py); the underlying images are Lite's.
    "lite-s": "SWE-bench/SWE-bench_Lite",
    "verified": "SWE-bench/SWE-bench_Verified",
}

BASELINES = ("gold", "noop")


def harness_supported(dataset_name: str) -> bool:
    return dataset_name in HARNESS_DATASET_MAP


def docker_available() -> bool:
    try:
        import docker as docker_sdk

        client = docker_sdk.from_env()
        client.ping()
        return True
    except Exception:
        return False


def _ensure_image(client: Any, image: str) -> None:
    """Pull the instance's image (amd64) if it isn't local.

    swebench's own create_container() does `images.pull(image)` with no
    platform, which fails with ImageNotFound on non-amd64 hosts (this one is
    aarch64, running the amd64 images under QEMU -- see module docstring), so
    the platform is pinned here first.
    """
    import docker as docker_sdk

    try:
        client.images.get(image)
    except docker_sdk.errors.ImageNotFound:
        client.images.pull(image, platform="linux/amd64")


def run_baseline(
    dataset_name: str,
    instance_ids: list[str],
    baseline: str,
    run_id: str | None = None,
    timeout: int = 900,
    on_start: Callable[[str], None] | None = None,
    on_phase: Callable[[str, str], None] | None = None,
    on_result: Callable[[str, dict[str, Any]], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, dict[str, Any]]:
    """Run `baseline` ("gold" or "noop") for each instance id, for real.

    Returns {instance_id: result}. `result["status"]` is one of:
      - "ran": container executed; see resolved/tests_status/duration_s.
      - "skipped": genuinely not attempted (unsupported dataset, docker
        unavailable, instance not found, or image not present); see "reason".
      - "error": attempted and raised; see "reason".
    Never fabricates a resolved/unresolved verdict for a skipped or errored
    instance.

    Optional hooks for background jobs: `on_start(iid)` before each instance,
    `on_result(iid, result)` after each one (also for instances skipped up
    front), and `should_cancel()` polled between instances (a container that
    is already running is allowed to finish).
    """
    def _done(iid: str, res: dict[str, Any]) -> None:
        if on_result:
            on_result(iid, res)

    if baseline not in BASELINES:
        raise ValueError(f"unknown baseline {baseline!r}, expected one of {BASELINES}")

    if not instance_ids:
        return {}

    def _skip_all(reason: str) -> dict[str, dict[str, Any]]:
        out = {iid: {"status": "skipped", "reason": reason} for iid in instance_ids}
        for iid, res in out.items():
            _done(iid, res)
        return out

    if dataset_name not in HARNESS_DATASET_MAP:
        return _skip_all(
            f"Docker execution is not wired up for dataset '{dataset_name}' in this pass "
            f"(see app/datasets/swebench_{dataset_name.replace('-', '_')}.py for why)."
        )

    if not docker_available():
        return _skip_all("docker daemon not reachable from this process")

    import docker as docker_sdk
    from swebench.harness.run_evaluation import run_instance as swe_run_instance
    from swebench.harness.utils import make_test_spec, load_swebench_dataset

    harness_dataset_id = HARNESS_DATASET_MAP[dataset_name]
    run_id = run_id or f"{baseline}-{int(time.time())}"

    try:
        instances = load_swebench_dataset(harness_dataset_id, "test", instance_ids)
    except Exception as e:  # e.g. network error, bad instance id
        return _skip_all(f"could not load harness dataset {harness_dataset_id!r}: {e}")

    found = {i["instance_id"]: i for i in instances}
    results: dict[str, dict[str, Any]] = {}
    for iid in instance_ids:
        if iid not in found:
            results[iid] = {
                "status": "skipped",
                "reason": f"instance not found in harness dataset {harness_dataset_id!r}",
            }
            _done(iid, results[iid])

    if not found:
        return results

    client = docker_sdk.from_env()
    _config.RUNS_DIR.mkdir(parents=True, exist_ok=True)

    with contextlib.chdir(_config.RUNS_DIR):
        for iid, instance in found.items():
            if should_cancel and should_cancel():
                results[iid] = {"status": "skipped", "reason": "cancelled before this instance started"}
                _done(iid, results[iid])
                continue
            if on_start:
                on_start(iid)
            test_spec = make_test_spec(instance)
            try:
                if on_phase:
                    on_phase(iid, "pulling image")
                _ensure_image(client, test_spec.image)
                if on_phase:
                    on_phase(iid, "running tests")
            except Exception as e:
                results[iid] = {"status": "skipped", "reason": f"could not pull image {test_spec.image}: {e}"}
                _done(iid, results[iid])
                continue
            if baseline == "gold":
                model_patch = instance["patch"]
                skip_patch = False
            else:  # noop: no candidate patch applied; run tests against base_commit as-is
                model_patch = ""
                skip_patch = True

            pred = {
                "instance_id": iid,
                "model_patch": model_patch,
                "model_name_or_path": baseline,
            }
            start = time.time()
            try:
                returned = swe_run_instance(
                    test_spec,
                    pred,
                    client,
                    run_id,
                    timeout=timeout,
                    rewrite_reports=False,
                    skip_patch=skip_patch,
                )
            except Exception as e:
                results[iid] = {"status": "error", "reason": str(e), "duration_s": time.time() - start}
                _done(iid, results[iid])
                continue
            duration = time.time() - start

            if returned is None:
                # run_instance() returns None on any internal failure
                # (image pull failure, patch-apply failure, timeout, etc.)
                # after logging the real reason under
                # data/runs/logs/run_evaluation/<run_id>/<baseline>/<iid>/.
                log_path = _config.RUNS_DIR / "logs" / "run_evaluation" / run_id / baseline / iid
                results[iid] = {
                    "status": "skipped",
                    "reason": (
                        "harness run_instance() returned no report -- likely an "
                        f"image pull failure or timeout; see {log_path} for the "
                        "real log the harness wrote"
                    ),
                    "duration_s": duration,
                }
                _done(iid, results[iid])
                continue

            _, report = returned
            inst_report = report.get(iid, {})
            results[iid] = {
                "status": "ran",
                "resolved": bool(inst_report.get("resolved", False)),
                "patch_successfully_applied": bool(inst_report.get("patch_successfully_applied", False)),
                "tests_status": inst_report.get("tests_status"),
                "duration_s": duration,
                "run_id": run_id,
            }
            _done(iid, results[iid])

    return results
