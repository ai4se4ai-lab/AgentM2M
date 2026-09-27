"""Central configuration for the bench service.

Kept deliberately small: file-based persistence under DATA_DIR, no external
services required to run tests or the API. Matches docs/dev.md section 8/9's
description of a Postgres-backed store, simplified here to local JSON/SQLite
files as the dev plan explicitly allows for this pass ("no Postgres needed
for this pass").
"""

from __future__ import annotations

import os
from pathlib import Path

# apps/bench/
BENCH_ROOT = Path(__file__).resolve().parent.parent

# Where fetched/normalized dataset instance records are persisted (JSON files,
# one per dataset name). Overridable via env var for tests so they don't
# clobber real fetched data.
DATA_DIR = Path(os.environ.get("BENCH_DATA_DIR", BENCH_ROOT / "data")).resolve()

# Where the harness writes run artifacts (predictions files, and where
# swebench's own run_evaluation writes logs/run_evaluation/<run_id>/...).
RUNS_DIR = Path(os.environ.get("BENCH_RUNS_DIR", DATA_DIR / "runs")).resolve()

# Where RQ1/RQ3 runners persist raw per-instance results.
EVAL_ROOT = Path(__file__).resolve().parent.parent / "evaluation"

DATA_DIR.mkdir(parents=True, exist_ok=True)
RUNS_DIR.mkdir(parents=True, exist_ok=True)


def instances_path(dataset_name: str) -> Path:
    return DATA_DIR / f"{dataset_name}.json"


def meta_path(dataset_name: str) -> Path:
    """Small sidecar (count + fetch time) so listing datasets never has to
    parse a multi-hundred-MB instances file."""
    return DATA_DIR / f"{dataset_name}.meta.json"


def jobs_dir() -> Path:
    d = DATA_DIR / "jobs"
    d.mkdir(parents=True, exist_ok=True)
    return d
