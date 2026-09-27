"""FastAPI service for apps/bench: SWE-bench-family dataset fetchers, a real
per-instance Docker execution harness, and RQ1/RQ3 evaluation runners.

Run with:
    uvicorn app.main:app --port 8000 --reload
(from apps/bench, with the .venv active).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app import jobs

from app.datasets.common import dataset_meta, load_persisted_instances
from app.datasets.registry import REGISTRY, list_benchmarks
from app.harness.docker_runner import BASELINES, docker_available, run_baseline
from evaluation.rq1_effectiveness.run import RESULTS_DIR as RQ1_RESULTS_DIR
from evaluation.rq3_ablations.run import RESULTS_DIR as RQ3_RESULTS_DIR

app = FastAPI(
    title="AgentM2M Benchmark & Evaluation Service",
    description=(
        "Dataset fetchers for the SWE-bench family, a real per-instance "
        "Docker execution harness, and RQ1/RQ3 evaluation runners. "
        "See apps/bench in the AgentM2M monorepo."
    ),
    version="0.1.0",
)

# The dashboard calls this service directly from the browser.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/docs")


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "docker_available": docker_available()}


# --------------------------------------------------------------------------
# Benchmarks
# --------------------------------------------------------------------------

@app.get("/api/benchmarks")
def get_benchmarks() -> list[dict[str, Any]]:
    return list_benchmarks()


class FetchRequest(BaseModel):
    limit: Optional[int] = None


@app.post("/api/benchmarks/{name}/fetch")
def fetch_benchmark(name: str, body: FetchRequest | None = None) -> dict[str, Any]:
    spec = REGISTRY.get(name)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"unknown dataset '{name}'; known: {list(REGISTRY)}")
    limit = body.limit if body else None
    try:
        instances = spec.fetch_and_persist(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"fetch failed for '{name}': {e}") from e
    return {"count": len(instances), "instances": [i.to_dict() for i in instances]}


@app.get("/api/benchmarks/{name}/instances")
def get_instances(name: str, detail: bool = False) -> dict[str, Any]:
    if name not in REGISTRY:
        raise HTTPException(status_code=404, detail=f"unknown dataset '{name}'; known: {list(REGISTRY)}")
    persisted = load_persisted_instances(name)
    if not persisted:
        return {"count": 0, "instances": [], "note": f"no instances persisted yet; POST /api/benchmarks/{name}/fetch first"}
    if detail:
        return {"count": len(persisted), "instances": persisted}
    summaries = [
        {
            "instance_id": rec["instance_id"],
            "repo": rec["repo"],
            "base_commit": rec["base_commit"],
            "dataset": rec["dataset"],
            "num_fail_to_pass": len(rec.get("FAIL_TO_PASS", [])),
            "num_pass_to_pass": len(rec.get("PASS_TO_PASS", [])),
            "docker_image": rec.get("docker_image"),
        }
        for rec in persisted
    ]
    return {"count": len(summaries), "instances": summaries}


class RunRequest(BaseModel):
    dataset: str
    baseline: Literal["gold", "noop"]
    instanceIds: Optional[list[str]] = None
    limit: Optional[int] = None
    timeout: int = 900
    runId: Optional[str] = None


@app.post("/api/benchmarks/run")
def run_benchmark(body: RunRequest) -> dict[str, Any]:
    if body.dataset not in REGISTRY:
        raise HTTPException(status_code=404, detail=f"unknown dataset '{body.dataset}'; known: {list(REGISTRY)}")
    if body.baseline not in BASELINES:
        raise HTTPException(status_code=400, detail=f"unknown baseline '{body.baseline}'; known: {BASELINES}")

    persisted = load_persisted_instances(body.dataset)
    if not persisted:
        raise HTTPException(
            status_code=400,
            detail=f"no instances persisted for '{body.dataset}' yet; POST /api/benchmarks/{body.dataset}/fetch first",
        )

    if body.instanceIds:
        available = {rec["instance_id"] for rec in persisted}
        unknown = [iid for iid in body.instanceIds if iid not in available]
        if unknown:
            raise HTTPException(status_code=400, detail=f"instance ids not found in persisted '{body.dataset}': {unknown}")
        instance_ids = body.instanceIds
    else:
        limit = body.limit or 2
        instance_ids = [rec["instance_id"] for rec in persisted[:limit]]

    results = run_baseline(body.dataset, instance_ids, body.baseline, run_id=body.runId, timeout=body.timeout)
    return {
        "dataset": body.dataset,
        "baseline": body.baseline,
        "instanceIds": instance_ids,
        "results": results,
    }


# --------------------------------------------------------------------------
# Background jobs (fetch / run / evaluate): return immediately, poll /api/jobs
# --------------------------------------------------------------------------

class FetchJobRequest(BaseModel):
    dataset: str
    limit: Optional[int] = None


class RunJobRequest(BaseModel):
    dataset: str
    baseline: Literal["gold", "noop"] = "gold"
    instanceIds: Optional[list[str]] = None
    limit: Optional[int] = 3  # 0 / null = every instance in the dataset
    timeout: int = 900


class EvaluateJobRequest(BaseModel):
    rq: Literal["rq1", "rq3"]
    dataset: str = "lite"
    instanceIds: Optional[list[str]] = None
    limit: Optional[int] = 3
    timeout: int = 900


def _require_dataset(name: str) -> None:
    if name not in REGISTRY:
        raise HTTPException(status_code=404, detail=f"unknown dataset '{name}'; known: {list(REGISTRY)}")


@app.post("/api/jobs/fetch", status_code=202)
def create_fetch_job(body: FetchJobRequest) -> dict[str, Any]:
    _require_dataset(body.dataset)
    return jobs.find_active("fetch", body.dataset) or jobs.submit_fetch(body.dataset, body.limit)


@app.post("/api/jobs/run", status_code=202)
def create_run_job(body: RunJobRequest) -> dict[str, Any]:
    _require_dataset(body.dataset)
    return jobs.submit_run(body.dataset, body.baseline, body.instanceIds, body.limit, body.timeout)


@app.post("/api/jobs/evaluate", status_code=202)
def create_evaluate_job(body: EvaluateJobRequest) -> dict[str, Any]:
    _require_dataset(body.dataset)
    return jobs.submit_evaluate(body.rq, body.dataset, body.instanceIds, body.limit, body.timeout)


@app.get("/api/jobs")
def list_jobs(kind: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    return jobs.list_jobs(kind, limit)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job '{job_id}'")
    return job


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, Any]:
    job = jobs.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job '{job_id}'")
    return job


# --------------------------------------------------------------------------
# Evaluation (RQ1 / RQ3 / hypotheses)
# --------------------------------------------------------------------------

def _read_aggregate(results_dir: Path) -> dict[str, Any] | None:
    path = results_dir / "aggregate.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


@app.get("/api/evaluation/rq1")
def get_rq1() -> dict[str, Any]:
    aggregate = _read_aggregate(RQ1_RESULTS_DIR)
    if aggregate is None:
        return {
            "computed": False,
            "note": (
                "RQ1 has not been run yet in this environment. Run "
                "`python -m evaluation.rq1_effectiveness.run --dataset lite "
                "--instance-ids <ids...>` (see apps/bench) to produce real "
                "gold/noop baseline numbers on a small sample."
            ),
        }
    return {"computed": True, **aggregate}


@app.get("/api/evaluation/rq3")
def get_rq3() -> dict[str, Any]:
    aggregate = _read_aggregate(RQ3_RESULTS_DIR)
    if aggregate is None:
        return {
            "computed": False,
            "note": (
                "RQ3 has not been run yet in this environment. Run "
                "`python -m evaluation.rq3_ablations.run --dataset lite "
                "--instance-ids <ids...>` (see apps/bench) to produce the "
                "real test-selection ablation on a small sample."
            ),
        }
    return {"computed": True, **aggregate}


HYPOTHESES = [
    {
        "id": "H1",
        "text": "AgentM2M(DevTeam) resolves more instances than DevTeam-NL on Verified and Pro.",
        "status": "not_evaluated_at_scale",
        "note": "Requires a live multi-agent run with an LLM backend and the DevTeam-NL control variant; none are wired up in this benchmark service (apps/engine owns the agents). No cloud LLM keys are configured in this environment.",
    },
    {
        "id": "H2",
        "text": "The AgentM2M advantage over DevTeam-NL grows with the number of files in the gold patch.",
        "status": "not_evaluated_at_scale",
        "note": "Depends on H1's comparison existing first; not computed.",
    },
    {
        "id": "H3",
        "text": "MAGIS-M2M resolves more instances than MAGIS.",
        "status": "not_evaluated_at_scale",
        "note": "Requires implementing both MAGIS and MAGIS-M2M team designs and running them; out of this service's scope.",
    },
    {
        "id": "H4",
        "text": "AgentM2M lowers the share of inter-agent misalignment failures (MAST taxonomy).",
        "status": "not_evaluated_at_scale",
        "note": "Requires RQ2's MAST LLM-as-judge annotation pipeline over real multi-agent traces; not implemented here.",
    },
    {
        "id": "H5",
        "text": "Removing backward restoration lowers the resolve rate on Pro.",
        "status": "not_evaluated_at_scale",
        "note": "Requires a live AgentM2M run with backward restoration togglable; lives in apps/engine, not computed here.",
    },
    {
        "id": "H6",
        "text": "Adaptive teams beat fixed teams in scenarios S1 and S3, with zero C3 violations.",
        "status": "not_evaluated_at_scale",
        "note": "Requires RQ4's scenario injectors against a live Adapt() implementation; not implemented here.",
    },
    {
        "id": "H7",
        "text": "Executable oracles have lower error rate than LLM judges.",
        "status": "not_evaluated_at_scale",
        "note": (
            "The executable-oracle side is real in this pass (the Docker harness's gold-baseline run "
            "is, by construction, error-free by definition on the sample it ran); there is no LLM-judge "
            "oracle implementation in this service to compare against, so no comparison is computed."
        ),
    },
]


@app.get("/api/evaluation/hypotheses")
def get_hypotheses() -> list[dict[str, Any]]:
    return HYPOTHESES
