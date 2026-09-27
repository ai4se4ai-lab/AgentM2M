"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { cancelJob, isJobActive, type BenchJob, type JobStatus } from "@/lib/bench-client";
import { useRefreshJobs } from "@/lib/use-bench-jobs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";

const STATUS_VARIANT: Record<JobStatus, "success" | "warning" | "destructive" | "secondary" | "accent"> = {
  queued: "secondary",
  running: "accent",
  completed: "success",
  failed: "destructive",
  cancelled: "warning",
};

export function jobTitle(j: BenchJob): string {
  if (j.kind === "fetch") return `Fetch ${j.dataset}`;
  if (j.kind === "run") return `Run ${j.dataset} · ${String(j.params.baseline ?? "gold")} baseline`;
  return `Evaluate ${String(j.params.rq ?? "").toUpperCase()} on ${j.dataset}`;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function JobRow({ job }: { job: BenchJob }) {
  const [open, setOpen] = useState(false);
  const refresh = useRefreshJobs();
  const cancel = useMutation({ mutationFn: () => cancelJob(job.id), onSuccess: refresh });
  const active = isJobActive(job);
  const results = Object.entries(job.results ?? {});
  const { done, total, current } = job.progress ?? { done: 0, total: 0, current: null };
  const s = job.summary;

  return (
    <div className="rounded-md border border-border text-sm" data-testid={`job-${job.kind}-${job.dataset}`} data-status={job.status}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <button
          type="button"
          className="text-muted-foreground disabled:opacity-30"
          disabled={results.length === 0}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Hide instance results" : "Show instance results"}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="font-medium">{jobTitle(job)}</span>
        <Badge variant={STATUS_VARIANT[job.status]} className="gap-1.5">
          {active ? <Spinner className="h-3 w-3" /> : null}
          {job.status}
          {active && job.phase && job.phase !== job.status ? ` · ${job.phase}` : ""}
        </Badge>
        {s && typeof s.n_resolved === "number" ? (
          <span className="font-mono text-xs">
            resolved {s.n_resolved}/{s.n_ran}
            {s.resolve_rate != null ? ` (${Math.round(s.resolve_rate * 100)}%)` : ""}
            {s.n_skipped ? ` · skipped ${s.n_skipped}` : ""}
            {s.n_errored ? ` · errored ${s.n_errored}` : ""}
          </span>
        ) : null}
        {s && typeof s.count === "number" ? <span className="font-mono text-xs">{s.count} instances</span> : null}
        <span className="ml-auto text-xs text-muted-foreground">{formatDate(job.createdAt)}</span>
        {active ? (
          <Button variant="outline" size="sm" disabled={cancel.isPending || job.cancelRequested} onClick={() => cancel.mutate()}>
            {job.cancelRequested ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null}
      </div>

      {active && total > 0 ? (
        <div className="space-y-1 px-3 pb-2">
          <ProgressBar done={done} total={total} />
          <p className="font-mono text-xs text-muted-foreground">
            {done}/{total} instances{current ? ` · running ${current}` : ""}
          </p>
        </div>
      ) : null}

      {job.error ? <p className="px-3 pb-2 text-xs text-destructive">{job.error}</p> : null}

      {open && results.length > 0 ? (
        <ul className="space-y-1 border-t border-border px-3 py-2">
          {results.map(([key, r]) => (
            <li key={key} className="flex flex-wrap items-center gap-2 font-mono text-xs">
              {r.status === "ran" ? (
                r.resolved ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                )
              ) : (
                <MinusCircle className="h-3.5 w-3.5 text-warning" />
              )}
              <span>{key}</span>
              <span className="text-muted-foreground">
                {r.status === "ran"
                  ? `${r.resolved ? "resolved" : "unresolved"} · F2P ${r.FAIL_TO_PASS?.passed ?? 0}/${
                      (r.FAIL_TO_PASS?.passed ?? 0) + (r.FAIL_TO_PASS?.failed ?? 0)
                    } · P2P ${r.PASS_TO_PASS?.passed ?? 0}/${(r.PASS_TO_PASS?.passed ?? 0) + (r.PASS_TO_PASS?.failed ?? 0)}${
                      r.duration_s != null ? ` · ${Math.round(r.duration_s)}s` : ""
                    }`
                  : `${r.status}${r.reason ? ` — ${r.reason}` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function JobList({ jobs, empty }: { jobs: BenchJob[]; empty: string }) {
  if (jobs.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </div>
  );
}
