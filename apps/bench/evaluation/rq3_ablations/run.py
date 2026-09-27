"""RQ3 (Contribution of Mechanisms) runner -- one real, no-LLM ablation axis.

The paper's RQ3 (docs/agentm2m.tex, subsec:rq3) ablates AgentM2M's
mechanisms one at a time (no guards, LLM-only restorers, forward-only, no
lift repair, fixed team) -- all of which require a live multi-agent run this
environment cannot perform (no LLM backend configured).

What this runner computes instead is a genuinely no-LLM-needed ablation in
the same spirit as "no guards": whether checking regression tests
(PASS_TO_PASS) in addition to the target tests (FAIL_TO_PASS) changes the
resolved verdict. This is exactly the "guard" AgentM2M's oracle performs on
every edge in the real system (docs/dev.md's oracle_executable.py) --
dropping it is a real, mechanical ablation of test selection, computed by
reprocessing the SAME real Docker harness output the gold/noop baselines
already produced (no separate LLM-only-restorer or forward-only variant
exists to run, so those remain "not computed" below rather than faked).

Two resolution criteria, both computed from the same real tests_status:
  - "strict"   : all FAIL_TO_PASS pass AND all PASS_TO_PASS pass (the actual
                 SWE-bench "resolved" definition -- checks for regressions).
  - "f2p_only" : all FAIL_TO_PASS pass, PASS_TO_PASS ignored (no regression
                 guard -- "test selection doesn't matter" variant).

Reuses the RQ1 runner's harness run_id (`rq1-<dataset>-<baseline>`) so this
is a genuine second analysis of the same containers, not a second real
run -- swebench's harness caches its per-instance report.json by run_id, so
if RQ1 has already run for these instances this executes instantly; if not,
it runs the same real Docker containers RQ1 would.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.harness.docker_runner import run_baseline

RESULTS_DIR = Path(__file__).resolve().parent / "results"
NOT_COMPUTED_AXES = [
    {
        "id": "no_guards",
        "reason": "requires a live restorer LLM call to compare 'first output accepted' vs. guarded; no LLM backend configured.",
    },
    {
        "id": "llm_only_restorers",
        "reason": "requires Rule_e vs. LLM-only restoration comparison; no live agent implemented in apps/bench (out of this service's scope -- lives in apps/engine).",
    },
    {
        "id": "forward_only",
        "reason": "requires a running AgentM2M team with backward restoration to disable; not available without apps/engine wired to a live model.",
    },
    {
        "id": "no_lift_repair",
        "reason": "requires the Lift algorithm's k_L repair loop; lives in apps/engine, not this benchmark service.",
    },
    {
        "id": "fixed_team",
        "reason": "requires L1/L2 adaptation to disable; lives in apps/engine, not this benchmark service.",
    },
]


def _criterion(tests_status: dict | None, criterion: str) -> bool | None:
    if not tests_status:
        return None
    f2p = tests_status.get("FAIL_TO_PASS", {})
    p2p = tests_status.get("PASS_TO_PASS", {})
    f2p_ok = len(f2p.get("failure", [])) == 0
    if criterion == "f2p_only":
        return f2p_ok
    p2p_ok = len(p2p.get("failure", [])) == 0
    return f2p_ok and p2p_ok


def run(dataset: str, instance_ids: list[str], timeout: int, **hooks) -> dict:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    per_baseline = {}
    for baseline in ("gold", "noop"):
        # Deliberately the same run_id the RQ1 runner uses, so a cached
        # report.json from an RQ1 run is reused instead of re-running the
        # container; if RQ1 hasn't run yet this performs the real run itself.
        run_id = f"rq1-{dataset}-{baseline}"
        results = run_baseline(dataset, instance_ids, baseline, run_id=run_id, timeout=timeout, **hooks)
        rows = {}
        for iid, r in results.items():
            if r.get("status") != "ran":
                rows[iid] = {"status": r.get("status"), "reason": r.get("reason")}
                continue
            rows[iid] = {
                "status": "ran",
                "strict_resolved": _criterion(r.get("tests_status"), "strict"),
                "f2p_only_resolved": _criterion(r.get("tests_status"), "f2p_only"),
            }
        per_baseline[baseline] = rows

    def rate(rows: dict, key: str) -> float | None:
        ran = [r for r in rows.values() if r.get("status") == "ran"]
        if not ran:
            return None
        return sum(1 for r in ran if r[key]) / len(ran)

    computed_axis = {
        "id": "test_selection_f2p_only_vs_f2p_and_p2p",
        "description": (
            "Does checking PASS_TO_PASS (regression) tests, not just "
            "FAIL_TO_PASS, change the resolved verdict? Computed on real "
            "Docker harness output, both baselines."
        ),
        "by_baseline": {
            baseline: {
                "strict_resolve_rate": rate(rows, "strict_resolved"),
                "f2p_only_resolve_rate": rate(rows, "f2p_only_resolved"),
                "n_ran": sum(1 for r in rows.values() if r.get("status") == "ran"),
                "instances_where_criteria_disagree": [
                    iid for iid, r in rows.items()
                    if r.get("status") == "ran" and r["strict_resolved"] != r["f2p_only_resolved"]
                ],
            }
            for baseline, rows in per_baseline.items()
        },
    }

    aggregate = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": dataset,
        "instance_ids": instance_ids,
        "label": (
            "RQ3-shaped small-N result. Only one ablation axis is actually "
            "computed here (test selection / regression guard, from real "
            "Docker harness output); the paper's mechanism ablations that "
            "need a live multi-agent LLM run are explicitly marked "
            "'requires_live_agent_not_computed' rather than invented."
        ),
        "computed": [computed_axis],
        "requires_live_agent_not_computed": NOT_COMPUTED_AXES,
        "per_instance": per_baseline,
    }
    (RESULTS_DIR / "aggregate.json").write_text(json.dumps(aggregate, indent=2, default=str))
    return aggregate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="lite")
    parser.add_argument("--instance-ids", nargs="+", required=True)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    aggregate = run(args.dataset, args.instance_ids, args.timeout)
    print(json.dumps(aggregate["computed"], indent=2))


if __name__ == "__main__":
    main()
