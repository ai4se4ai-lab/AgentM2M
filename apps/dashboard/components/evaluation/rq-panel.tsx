"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { createEvaluateJob, getRqResult } from "@/lib/bench-client";
import { activeJob, useBenchJobs, useRefreshJobs } from "@/lib/use-bench-jobs";
import { Button } from "@/components/ui/button";
import { JobList } from "@/components/bench/job-list";
import { Spinner } from "@/components/ui/spinner";
import { BenchUnavailable } from "@/components/bench/bench-unavailable";
import { RqBarChart, inferChartFields } from "@/components/charts/rq-bar-chart";

export function RqPanel({ rq, title, description }: { rq: string; title: string; description: string }) {
  const qc = useQueryClient();
  const refreshJobs = useRefreshJobs();
  const { data, isLoading, error } = useQuery({ queryKey: ["rq", rq], queryFn: () => getRqResult(rq), retry: 0 });

  // RQ1/RQ3 are the two RQs bench can compute; each runs as a server-side job.
  const computable = rq === "rq1" || rq === "rq3";
  const jobsQuery = useBenchJobs();
  const rqJobs = (jobsQuery.data ?? []).filter((j) => j.kind === "evaluate" && j.params.rq === rq);
  const running = activeJob(jobsQuery.data, (j) => j.kind === "evaluate" && j.params.rq === rq);
  const evaluate = useMutation({
    mutationFn: () => createEvaluateJob({ rq: rq as "rq1" | "rq3", dataset: "lite", limit: 3 }),
    onSuccess: refreshJobs,
  });

  // When a running evaluation finishes, pull in its freshly written results.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) qc.invalidateQueries({ queryKey: ["rq", rq] });
    wasRunning.current = !!running;
  }, [running, qc, rq]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {computable ? (
          <Button size="sm" disabled={!!running || evaluate.isPending} onClick={() => evaluate.mutate()}>
            <PlayCircle /> Run on Lite (3 instances)
          </Button>
        ) : null}
      </div>
      {computable && rqJobs.length > 0 ? <JobList jobs={rqJobs.slice(0, 2)} empty="" /> : null}
      {evaluate.isError ? <BenchUnavailable error={evaluate.error} /> : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading {rq.toUpperCase()} results...
        </div>
      ) : error ? (
        <BenchUnavailable error={error} />
      ) : !data || data.rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No {rq.toUpperCase()} results reported yet.
        </p>
      ) : (
        <>
          {(() => {
            const fields = inferChartFields(data.rows);
            return fields ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <RqBarChart rows={data.rows} categoryKey={fields.categoryKey} valueKeys={fields.valueKeys} />
              </div>
            ) : null;
          })()}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {Object.keys(data.rows[0]).map((k) => (
                    <th key={k} className="px-3 py-2">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    {Object.keys(data.rows[0]).map((k) => (
                      <td key={k} className="px-3 py-2 font-mono text-xs">
                        {String(row[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
