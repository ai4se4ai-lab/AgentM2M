"""Fetcher for SWE-bench Verified (500 human-validated instances).

Real fetch via HuggingFace `datasets` against `princeton-nlp/SWE-bench_Verified`.
Verified live: 500 instances, with a `difficulty` field on top of the base
SWE-bench schema.
"""

from __future__ import annotations

from datasets import load_dataset

from app.datasets.common import Instance, normalize_row, persist_instances

HF_DATASET_ID = "princeton-nlp/SWE-bench_Verified"
SPLIT = "test"
DATASET_NAME = "verified"

EXTRA_KEYS = ["hints_text", "created_at", "version", "environment_setup_commit", "difficulty"]


def fetch_verified(limit: int | None = None) -> list[Instance]:
    ds = load_dataset(HF_DATASET_ID, split=SPLIT)
    rows = ds if limit is None else ds.select(range(min(limit, len(ds))))
    return [normalize_row(dict(row), DATASET_NAME, EXTRA_KEYS) for row in rows]


def fetch_and_persist(limit: int | None = None) -> list[Instance]:
    instances = fetch_verified(limit=limit)
    persist_instances(DATASET_NAME, instances)
    return instances
