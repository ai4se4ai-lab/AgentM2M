"""Single place that knows about every SWE-bench-family dataset this service
can fetch, and whether real Docker execution is wired up for it.

The API layer (`GET /api/benchmarks`) reads this registry rather than
special-casing dataset names, so adding a dataset means adding one entry
here plus its fetcher module.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.datasets import swebench_lite, swebench_live, swebench_pro, swebench_verified
from app.datasets.common import Instance, dataset_meta
from app.harness.docker_runner import harness_supported


@dataclass
class DatasetSpec:
    name: str
    label: str
    hf_dataset_id: str
    fetch_and_persist: Callable[..., list[Instance]]
    docker_execution_supported: bool
    note: str | None = None


REGISTRY: dict[str, DatasetSpec] = {
    "lite": DatasetSpec(
        name="lite",
        label="SWE-bench Lite",
        hf_dataset_id=swebench_lite.HF_DATASET_ID,
        fetch_and_persist=swebench_lite.fetch_and_persist,
        docker_execution_supported=harness_supported("lite"),
    ),
    "lite-s": DatasetSpec(
        name="lite-s",
        label="SWE-bench Lite-S",
        hf_dataset_id=swebench_lite.HF_DATASET_ID,
        fetch_and_persist=swebench_lite.fetch_and_persist_lite_s,
        docker_execution_supported=harness_supported("lite-s"),
        note=(
            "Filtered Lite: excludes Agentless's flagged instances. The exact "
            "exclusion list was not sourced in this pass (see "
            "app/datasets/swebench_lite.py); the filter mechanism is real but "
            "its exclusion set is currently empty, so Lite-S == Lite for now."
        ),
    ),
    "verified": DatasetSpec(
        name="verified",
        label="SWE-bench Verified",
        hf_dataset_id=swebench_verified.HF_DATASET_ID,
        fetch_and_persist=swebench_verified.fetch_and_persist,
        docker_execution_supported=harness_supported("verified"),
    ),
    "live": DatasetSpec(
        name="live",
        label="SWE-bench-Live",
        hf_dataset_id=swebench_live.HF_DATASET_ID,
        fetch_and_persist=swebench_live.fetch_and_persist,
        docker_execution_supported=swebench_live.DOCKER_EXECUTION_SUPPORTED,
        note=swebench_live.DOCKER_EXECUTION_NOTE,
    ),
    "pro": DatasetSpec(
        name="pro",
        label="SWE-Bench Pro",
        hf_dataset_id=swebench_pro.HF_DATASET_ID,
        fetch_and_persist=swebench_pro.fetch_and_persist,
        docker_execution_supported=swebench_pro.DOCKER_EXECUTION_SUPPORTED,
        note=swebench_pro.DOCKER_EXECUTION_NOTE,
    ),
}


def list_benchmarks() -> list[dict]:
    """[{name, label, available, instanceCount, note}] for GET /api/benchmarks.

    `available` reflects whether metadata has actually been fetched and
    persisted yet (not whether the dataset *could* be fetched) -- this is
    queried from disk, never assumed.
    """
    out = []
    for spec in REGISTRY.values():
        meta = dataset_meta(spec.name)
        out.append(
            {
                "name": spec.name,
                "label": spec.label,
                "available": meta["count"] > 0,
                "instanceCount": meta["count"] or None,
                "fetchedAt": meta["fetchedAt"],
                "dockerExecutionSupported": spec.docker_execution_supported,
                "note": spec.note,
            }
        )
    return out
