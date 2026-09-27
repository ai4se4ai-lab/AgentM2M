"""Background jobs for long-running bench work (dataset fetches, harness runs,
RQ evaluations).

Why this exists: fetching a dataset or running the Docker harness takes
seconds to hours. Doing that inside a single HTTP request ties the work to
the caller's connection (a page navigation or timeout aborts the caller's
view of it, and gives no progress). Here the API returns a job id at once,
the work runs on a server-side worker thread, and clients poll
`GET /api/jobs`. Every state change is persisted to DATA_DIR/jobs/<id>.json,
so job history survives page switches and is reported honestly after a
service restart (a job that was mid-flight is marked failed/interrupted,
never left "running" forever).

Concurrency: the swebench harness does a process-wide `os.chdir`
(docker_runner.run_baseline), so harness work is strictly serialised on one
worker thread. Fetches run on a separate single worker so a long
`live` download doesn't block a harness run (and vice versa).
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable

from app import config as _config

ACTIVE = ("queued", "running")

_lock = threading.RLock()
_jobs: dict[str, dict[str, Any]] = {}
_cancel: set[str] = set()
_loaded_dir: str | None = None
_fetch_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bench-fetch")
_run_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bench-run")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _path(job_id: str):
    return _config.jobs_dir() / f"{job_id}.json"


def _save(job: dict[str, Any]) -> None:
    tmp = _path(job["id"]).with_suffix(".tmp")
    tmp.write_text(json.dumps(job, default=str))
    tmp.replace(_path(job["id"]))


def _ensure_loaded() -> None:
    """Load persisted jobs once per data dir; mark leftovers of a dead process."""
    global _loaded_dir
    d = str(_config.jobs_dir())
    if _loaded_dir == d:
        return
    _jobs.clear()
    for f in _config.jobs_dir().glob("*.json"):
        try:
            job = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if job.get("status") in ACTIVE:
            job.update(
                status="failed",
                finishedAt=_now(),
                error="Interrupted: the bench service restarted while this job was in flight.",
            )
            _save(job)
        _jobs[job["id"]] = job
    _loaded_dir = d


def _update(job_id: str, **fields: Any) -> dict[str, Any]:
    with _lock:
        job = _jobs[job_id]
        job.update(fields)
        _save(job)
        return job


def _progress(job_id: str, **fields: Any) -> None:
    with _lock:
        job = _jobs[job_id]
        job["progress"] = {**job.get("progress", {}), **fields}
        _save(job)


def get(job_id: str) -> dict[str, Any] | None:
    with _lock:
        _ensure_loaded()
        job = _jobs.get(job_id)
        return json.loads(json.dumps(job)) if job else None


def list_jobs(kind: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    with _lock:
        _ensure_loaded()
        rows = [j for j in _jobs.values() if kind is None or j["kind"] == kind]
        rows.sort(key=lambda j: j["createdAt"], reverse=True)
        return json.loads(json.dumps(rows[:limit]))


def find_active(kind: str, dataset: str) -> dict[str, Any] | None:
    for j in list_jobs(kind):
        if j["dataset"] == dataset and j["status"] in ACTIVE:
            return j
    return None


def cancel(job_id: str) -> dict[str, Any] | None:
    with _lock:
        _ensure_loaded()
        job = _jobs.get(job_id)
        if job is None:
            return None
        if job["status"] in ACTIVE:
            # A queued job is skipped when its turn comes; a running harness
            # job stops before its next instance (the current container finishes).
            _cancel.add(job_id)
            job["cancelRequested"] = True
            _save(job)
        return json.loads(json.dumps(job))


def _new_job(kind: str, dataset: str, params: dict[str, Any]) -> dict[str, Any]:
    job = {
        "id": f"{kind}-{int(time.time())}-{uuid.uuid4().hex[:6]}",
        "kind": kind,
        "dataset": dataset,
        "params": params,
        "status": "queued",
        "phase": "queued",
        "createdAt": _now(),
        "startedAt": None,
        "finishedAt": None,
        "progress": {"done": 0, "total": 0, "current": None},
        "results": {},
        "summary": None,
        "error": None,
        "cancelRequested": False,
    }
    with _lock:
        _ensure_loaded()
        _jobs[job["id"]] = job
        _save(job)
    return job


def _summarize_result(r: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        k: r.get(k) for k in ("status", "resolved", "patch_successfully_applied", "duration_s", "reason") if k in r
    }
    ts = r.get("tests_status") or {}
    for group in ("FAIL_TO_PASS", "PASS_TO_PASS"):
        if group in ts:
            out[group] = {
                "passed": len(ts[group].get("success", [])),
                "failed": len(ts[group].get("failure", [])),
            }
    return out


def _tally(results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    ran = [r for r in results.values() if r.get("status") == "ran"]
    resolved = sum(1 for r in ran if r.get("resolved"))
    return {
        "n_instances": len(results),
        "n_ran": len(ran),
        "n_resolved": resolved,
        "resolve_rate": (resolved / len(ran)) if ran else None,
        "n_skipped": sum(1 for r in results.values() if r.get("status") == "skipped"),
        "n_errored": sum(1 for r in results.values() if r.get("status") == "error"),
    }


def _fail_if_nothing_ran(summary: dict[str, Any], results: dict[str, dict[str, Any]]) -> None:
    """A run whose every instance was skipped/errored produced no result; say so."""
    if summary["n_instances"] and summary["n_ran"] == 0 and not any(
        r.get("reason", "").startswith("cancelled") for r in results.values()
    ):
        reasons = {str(r.get("reason")) for r in results.values()}
        raise RuntimeError(f"No instance executed ({summary['n_skipped']} skipped, {summary['n_errored']} errored): " + "; ".join(sorted(reasons))[:400])


def _wrap(job_id: str, work: Callable[[], None]) -> Callable[[], None]:
    def runner() -> None:
        with _lock:
            if job_id in _cancel:
                _update(job_id, status="cancelled", phase="cancelled", finishedAt=_now())
                return
            _update(job_id, status="running", phase="running", startedAt=_now())
        try:
            work()
        except Exception as e:  # noqa: BLE001 -- surface any failure on the job
            _update(job_id, status="failed", phase="failed", finishedAt=_now(), error=f"{type(e).__name__}: {e}")
            return
        with _lock:
            cancelled = job_id in _cancel
            _update(
                job_id,
                status="cancelled" if cancelled else "completed",
                phase="cancelled" if cancelled else "completed",
                finishedAt=_now(),
            )

    return runner


def _is_cancelled(job_id: str) -> bool:
    with _lock:
        return job_id in _cancel


# --------------------------------------------------------------------------
# Job kinds
# --------------------------------------------------------------------------

def submit_fetch(dataset: str, limit: int | None) -> dict[str, Any]:
    from app.datasets.registry import REGISTRY

    job = _new_job("fetch", dataset, {"limit": limit})

    def work() -> None:
        _update(job["id"], phase="downloading")
        instances = REGISTRY[dataset].fetch_and_persist(limit=limit)
        _update(job["id"], phase="done", summary={"count": len(instances)})
        _progress(job["id"], done=len(instances), total=len(instances))

    _fetch_pool.submit(_wrap(job["id"], work))
    return job


def _select_ids(dataset: str, instance_ids: list[str] | None, limit: int | None) -> list[str]:
    from app.datasets.common import load_persisted_instances

    persisted = load_persisted_instances(dataset)
    available = [rec["instance_id"] for rec in persisted]
    if instance_ids:
        unknown = [i for i in instance_ids if i not in set(available)]
        if unknown:
            raise ValueError(f"instance ids not found in persisted '{dataset}': {unknown}")
        return instance_ids
    if limit is None or limit <= 0:
        return available
    return available[:limit]


def _ensure_persisted(job_id: str, dataset: str) -> None:
    from app.datasets.common import dataset_meta
    from app.datasets.registry import REGISTRY

    if dataset_meta(dataset)["count"] == 0:
        _update(job_id, phase="fetching dataset")
        REGISTRY[dataset].fetch_and_persist(limit=None)


def _hooks(job_id: str, total: int, key_fn: Callable[[str, int], str] = lambda iid, n: iid):
    """Progress hooks for run_baseline. `key_fn(iid, n_done_so_far)` names the
    result slot (evaluate runs two baselines over the same ids)."""
    state = {"done": 0}

    def on_start(iid: str) -> None:
        _progress(job_id, current=iid)

    def on_phase(iid: str, text: str) -> None:
        _progress(job_id, current=f"{iid} ({text})")

    def on_result(iid: str, res: dict[str, Any]) -> None:
        with _lock:
            _jobs[job_id]["results"][key_fn(iid, state["done"])] = _summarize_result(res)
        state["done"] += 1
        _progress(job_id, done=state["done"], total=total, current=None)

    return {"on_start": on_start, "on_phase": on_phase, "on_result": on_result, "should_cancel": lambda: _is_cancelled(job_id)}


def submit_run(
    dataset: str,
    baseline: str,
    instance_ids: list[str] | None,
    limit: int | None,
    timeout: int,
) -> dict[str, Any]:
    from app.harness.docker_runner import harness_supported, run_baseline

    job = _new_job(
        "run", dataset, {"baseline": baseline, "instanceIds": instance_ids, "limit": limit, "timeout": timeout}
    )

    def work() -> None:
        if not harness_supported(dataset):
            raise RuntimeError(
                f"Docker execution is not wired up for '{dataset}' (see /api/benchmarks note); "
                "only lite, lite-s and verified can be executed."
            )
        _ensure_persisted(job["id"], dataset)
        ids = _select_ids(dataset, instance_ids, limit)
        _update(job["id"], phase="running harness", params={**job["params"], "resolvedInstanceIds": ids})
        _progress(job["id"], done=0, total=len(ids))
        results = run_baseline(dataset, ids, baseline, run_id=job["id"], timeout=timeout, **_hooks(job["id"], len(ids)))
        summary = _tally(results)
        _update(job["id"], summary=summary)
        _fail_if_nothing_ran(summary, results)

    _run_pool.submit(_wrap(job["id"], work))
    return job


def submit_evaluate(rq: str, dataset: str, instance_ids: list[str] | None, limit: int | None, timeout: int) -> dict[str, Any]:
    from app.harness.docker_runner import harness_supported

    job = _new_job(
        "evaluate", dataset, {"rq": rq, "instanceIds": instance_ids, "limit": limit, "timeout": timeout}
    )

    def work() -> None:
        if not harness_supported(dataset):
            raise RuntimeError(f"Docker execution is not wired up for '{dataset}'; RQ runs need lite, lite-s or verified.")
        _ensure_persisted(job["id"], dataset)
        ids = _select_ids(dataset, instance_ids, limit)
        _update(job["id"], phase=f"running {rq} harness", params={**job["params"], "resolvedInstanceIds": ids})
        total = len(ids) * 2  # gold + noop baselines
        _progress(job["id"], done=0, total=total)
        n = len(ids)
        key_fn = lambda iid, done: f"{'gold' if done < n else 'noop'}:{iid}"  # noqa: E731 -- runners go gold, then noop
        if rq == "rq1":
            from evaluation.rq1_effectiveness.run import run as rq_run
        else:
            from evaluation.rq3_ablations.run import run as rq_run
        aggregate = rq_run(dataset, ids, timeout, **_hooks(job["id"], total, key_fn))
        _update(job["id"], summary={"baselines": aggregate.get("baselines"), "generated_at": aggregate.get("generated_at")})
        baselines = aggregate.get("baselines") or {}
        if baselines and all(b["n_ran"] == 0 for b in baselines.values()):
            reasons = {v for b in baselines.values() for v in {**b["skipped_reasons"], **b["errored_reasons"]}.values()}
            raise RuntimeError("No instance executed: " + "; ".join(sorted(map(str, reasons)))[:400])

    _run_pool.submit(_wrap(job["id"], work))
    return job
