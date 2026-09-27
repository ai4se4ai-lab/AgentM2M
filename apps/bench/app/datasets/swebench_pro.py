"""Fetcher for SWE-Bench Pro (human-verified, long-horizon, multi-file tasks).

Status: REAL metadata fetch. `ScaleAI/SWE-bench_Pro` on HuggingFace is public
(no gating found) and loads via `datasets.load_dataset` -- confirmed live
during this build: the default "test" split (v2 config) returns 642
instances with repo/instance_id/base_commit/patch/test_patch/
problem_statement/fail_to_pass/pass_to_pass plus Pro-specific fields
(requirements, interface, docker_image, dockerhub_tag, before_repo_set_cmd,
selected_test_files_to_run, hard).

Honest limitation: SWE-Bench Pro ships its own evaluation harness
(scaleapi/SWE-bench_Pro-os), which drives containers via
`before_repo_set_cmd` + `selected_test_files_to_run` rather than the
`swebench` PyPI package's `eval_script`/`log_parser`/`eval_type` triplet
that `make_test_spec` expects. Even though `docker_image`/`dockerhub_tag`
are present, docker_runner.py in this pass only drives the princeton
`swebench` harness (used for Lite/Verified), so Pro's Docker execution is
NOT wired up here -- reported honestly via DOCKER_EXECUTION_SUPPORTED rather
than attempted with a mismatched harness and silently mis-scored.
"""

from __future__ import annotations

from datasets import load_dataset

from app.datasets.common import Instance, normalize_row, persist_instances

HF_DATASET_ID = "ScaleAI/SWE-bench_Pro"
SPLIT = "test"
DATASET_NAME = "pro"

EXTRA_KEYS = [
    "requirements", "interface", "repo_language", "issue_specificity",
    "issue_categories", "before_repo_set_cmd", "selected_test_files_to_run",
    "dockerhub_tag", "hard", "version",
]

DOCKER_EXECUTION_SUPPORTED = False
DOCKER_EXECUTION_NOTE = (
    "SWE-Bench Pro ships its own harness (before_repo_set_cmd + "
    "selected_test_files_to_run), incompatible with the princeton `swebench` "
    "package's eval_script/log_parser path this pass's docker_runner.py "
    "drives; not wired up in this pass."
)


def fetch_pro(limit: int | None = None) -> list[Instance]:
    ds = load_dataset(HF_DATASET_ID, split=SPLIT)
    rows = ds if limit is None else ds.select(range(min(limit, len(ds))))
    return [
        normalize_row(dict(row), DATASET_NAME, EXTRA_KEYS, docker_image_key="docker_image")
        for row in rows
    ]


def fetch_and_persist(limit: int | None = None) -> list[Instance]:
    instances = fetch_pro(limit=limit)
    persist_instances(DATASET_NAME, instances)
    return instances
