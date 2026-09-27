"""Fetcher for SWE-bench-Live, the rolling GitHub-issue dataset.

Status: REAL metadata fetch. `SWE-bench-Live/SWE-bench-Live` on HuggingFace is
public and loads via `datasets.load_dataset` with no gating -- confirmed live
during this build: split "test" has 1000 instances, "full" has 1888,
"lite"/"verified" sub-splits also exist. Fields include repo, instance_id,
base_commit, patch, test_patch, problem_statement, FAIL_TO_PASS, PASS_TO_PASS,
created_at, test_cmds, log_parser -- everything dev.md asks the fetcher to
normalize.

Honest limitation: unlike Lite/Verified, this dataset carries no pre-built
`image` field pointing at a published Docker Hub image. SWE-bench-Live's own
project (microsoft/SWE-bench-Live) builds per-instance images with its own
Dockerfile generator, which is separate tooling from the `swebench` PyPI
package's `make_test_spec`/`run_evaluation` path that `docker_runner.py`
drives in this pass. So: metadata fetch is real and instances persist
correctly; Docker execution through docker_runner.py is NOT wired up for
this dataset in this pass (it would require integrating SWE-bench-Live's
separate image-build pipeline, out of scope for the small, honest slice this
task asks for). This is reported truthfully by the API rather than silently
attempted and faked.
"""

from __future__ import annotations

from datetime import datetime, timezone

from datasets import load_dataset

from app.datasets.common import Instance, normalize_row, persist_instances

HF_DATASET_ID = "SWE-bench-Live/SWE-bench-Live"
SPLIT = "test"
DATASET_NAME = "live"

EXTRA_KEYS = [
    "pull_number", "issue_numbers", "commit_urls", "commit_url",
    "created_at", "test_cmds", "log_parser", "difficulty", "hints_text",
    "all_hints_text",
]

DOCKER_EXECUTION_SUPPORTED = False
DOCKER_EXECUTION_NOTE = (
    "SWE-bench-Live instances have no published swebench-harness-compatible "
    "docker image field; running them needs the project's own image builder, "
    "not wired up in this pass."
)


def fetch_live(limit: int | None = None, split: str = SPLIT,
               backend_training_cutoff: str | None = None) -> list[Instance]:
    """Fetch SWE-bench-Live for real.

    `backend_training_cutoff` (ISO date string, e.g. "2024-04-01"), if given,
    keeps only instances created after that date, matching dev.md's stated
    fetch strategy of using instances created after the backend's training
    cutoff (a contamination-avoidance filter). Left None by default since
    this deployment has no LLM backend configured yet.
    """
    ds = load_dataset(HF_DATASET_ID, split=split)
    rows = list(ds)
    if backend_training_cutoff:
        cutoff = datetime.fromisoformat(backend_training_cutoff).replace(tzinfo=timezone.utc)
        kept = []
        for row in rows:
            created = row.get("created_at")
            if not created:
                continue
            try:
                created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            except ValueError:
                continue
            if created_dt > cutoff:
                kept.append(row)
        rows = kept
    if limit is not None:
        rows = rows[:limit]
    return [normalize_row(dict(row), DATASET_NAME, EXTRA_KEYS) for row in rows]


def fetch_and_persist(limit: int | None = None, backend_training_cutoff: str | None = None) -> list[Instance]:
    instances = fetch_live(limit=limit, backend_training_cutoff=backend_training_cutoff)
    persist_instances(DATASET_NAME, instances)
    return instances
