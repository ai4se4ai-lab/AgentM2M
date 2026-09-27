"""RQ1 (Effectiveness) runner -- small-N, honest, no-LLM-baseline version.

The paper's RQ1 (docs/agentm2m.tex, subsec:rq1) compares resolve rates of
AgentM2M(DevTeam) against single-agent/pipeline/multi-agent baselines and
controlled DevTeam variants, at benchmark scale (Lite/Lite-S/Verified/Live/
Pro, three runs each). None of those systems exist yet in this repo -- there
is no live-agent backend configured (see task brief: "no cloud LLM API keys
configured"). What CAN be computed for real, without any LLM, is the two
baselines this pass's harness makes honest: `gold` (apply the dataset's own
patch -- sanity check that the harness is wired correctly) and `noop` (apply
no patch -- the "did nothing" floor). This is a floor/ceiling calibration of
the harness, not a reproduction of the paper's RQ1 comparison; the aggregate
output says so explicitly.

Usage:
    python -m evaluation.rq1_effectiveness.run --dataset lite \
        --instance-ids psf__requests-1963 psf__requests-2148 pallets__flask-4045 \
        --timeout 900
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from app.harness.docker_runner import run_baseline

RESULTS_DIR = Path(__file__).resolve().parent / "results"
BASELINES = ("gold", "noop")


def summarize(results: dict[str, dict]) -> dict:
    ran = {iid: r for iid, r in results.items() if r.get("status") == "ran"}
    skipped = {iid: r for iid, r in results.items() if r.get("status") == "skipped"}
    errored = {iid: r for iid, r in results.items() if r.get("status") == "error"}
    n_resolved = sum(1 for r in ran.values() if r.get("resolved"))
    return {
        "n_instances": len(results),
        "n_ran": len(ran),
        "n_resolved": n_resolved,
        "resolve_rate": (n_resolved / len(ran)) if ran else None,
        "n_skipped": len(skipped),
        "n_errored": len(errored),
        "skipped_reasons": {iid: r.get("reason") for iid, r in skipped.items()},
        "errored_reasons": {iid: r.get("reason") for iid, r in errored.items()},
    }


def run(dataset: str, instance_ids: list[str], timeout: int, **hooks) -> dict:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    aggregate = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": dataset,
        "instance_ids": instance_ids,
        "label": (
            "RQ1-shaped calibration: gold vs. noop baselines only. This is NOT "
            "the paper's RQ1 (no live coding agent is configured in this "
            "environment -- see docs/dev.md sec 8/9 and the task brief). It is "
            "a small, real, honest sanity check that the Docker execution "
            "harness scores a correct patch as resolved and an absent patch "
            "as (mostly) unresolved."
        ),
        "baselines": {},
        "per_instance": {},
    }
    for baseline in BASELINES:
        run_id = f"rq1-{dataset}-{baseline}"
        results = run_baseline(dataset, instance_ids, baseline, run_id=run_id, timeout=timeout, **hooks)
        (RESULTS_DIR / f"{dataset}_{baseline}.json").write_text(json.dumps(results, indent=2))
        aggregate["baselines"][baseline] = summarize(results)
        aggregate["per_instance"][baseline] = results

    (RESULTS_DIR / "aggregate.json").write_text(json.dumps(aggregate, indent=2, default=str))
    return aggregate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="lite")
    parser.add_argument("--instance-ids", nargs="+", required=True)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    aggregate = run(args.dataset, args.instance_ids, args.timeout)
    print(json.dumps(aggregate["baselines"], indent=2))


if __name__ == "__main__":
    main()
