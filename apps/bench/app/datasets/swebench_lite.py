"""Fetcher for SWE-bench Lite (300 instances) and its Lite-S filtered subset.

Real fetch: uses the HuggingFace `datasets` library against
`princeton-nlp/SWE-bench_Lite`, exactly as docs/dev.md section 8 specifies.
Verified against a live run of this module: 300 instances come back, with
all of instance_id/repo/base_commit/problem_statement/patch/test_patch/
FAIL_TO_PASS/PASS_TO_PASS populated (see apps/bench tests for the recorded
fixture-based assertions).
"""

from __future__ import annotations

from datasets import load_dataset

from app.datasets.common import Instance, normalize_row, persist_instances

HF_DATASET_ID = "princeton-nlp/SWE-bench_Lite"
SPLIT = "test"
DATASET_NAME = "lite"
LITE_S_DATASET_NAME = "lite-s"

EXTRA_KEYS = ["hints_text", "created_at", "version", "environment_setup_commit"]

# --- Lite-S exclusion list -------------------------------------------------
# SWE-bench Lite-S, as described by Agentless (Xia et al. 2024,
# https://arxiv.org/abs/2407.01489), excludes a manually-identified set of
# Lite instances whose issue descriptions are insufficient or misleading for
# an agent to act on. Agentless's own repo/paper artifacts publish this exact
# instance-id list, but sourcing it required a web lookup that was rate
# -limited during this session (WebSearch/WebFetch hit a session cap while
# fetching it) and was not completed before this pass had to ship.
#
# Rather than fabricate the list, this is left as an explicit, empty
# placeholder. The filter mechanism below (`fetch_lite_s`) is real and will
# correctly exclude whatever instance ids are added here -- it is the *data*
# that is missing, not the mechanism. Anyone completing this later should
# populate this set from the Agentless artifact and Lite-S will immediately
# reflect it (currently Lite-S == Lite, which the API layer reports
# honestly via a `note` field).
AGENTLESS_FLAGGED_INSTANCE_IDS: set[str] = set()


def fetch_lite(limit: int | None = None) -> list[Instance]:
    """Fetch SWE-bench Lite for real via HuggingFace `datasets`."""
    ds = load_dataset(HF_DATASET_ID, split=SPLIT)
    rows = ds if limit is None else ds.select(range(min(limit, len(ds))))
    return [normalize_row(dict(row), DATASET_NAME, EXTRA_KEYS) for row in rows]


def fetch_lite_s(limit: int | None = None) -> list[Instance]:
    """Lite filtered to exclude Agentless's flagged instances.

    See AGENTLESS_FLAGGED_INSTANCE_IDS above: the exclusion set is currently
    empty because the exact list wasn't sourced in this pass, so this is
    presently equivalent to Lite. The filter itself is real and will apply
    correctly once the ids are populated.
    """
    full = fetch_lite(limit=None)
    filtered = [i for i in full if i.instance_id not in AGENTLESS_FLAGGED_INSTANCE_IDS]
    filtered = [Instance(**{**i.__dict__, "dataset": LITE_S_DATASET_NAME}) for i in filtered]
    if limit is not None:
        filtered = filtered[:limit]
    return filtered


def fetch_and_persist(limit: int | None = None) -> list[Instance]:
    instances = fetch_lite(limit=limit)
    persist_instances(DATASET_NAME, instances)
    return instances


def fetch_and_persist_lite_s(limit: int | None = None) -> list[Instance]:
    instances = fetch_lite_s(limit=limit)
    persist_instances(LITE_S_DATASET_NAME, instances)
    return instances
