"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Database, Download, PlayCircle } from "lucide-react";
import { listDatasets, createFetchJob, createRunJob, isJobActive } from "@/lib/bench-client";
import { activeJob, useBenchJobs, useRefreshJobs } from "@/lib/use-bench-jobs";
import { PageHeader } from "@/components/nav/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BenchUnavailable } from "@/components/bench/bench-unavailable";
import { JobList } from "@/components/bench/job-list";
import { formatDate } from "@/lib/utils";

const KNOWN_DATASETS = [
  { id: "lite", name: "SWE-bench Lite", hint: "300 instances" },
  { id: "lite-s", name: "SWE-bench Lite-S", hint: "Lite minus flagged instances" },
  { id: "verified", name: "SWE-bench Verified", hint: "500 human-validated instances" },
  { id: "live", name: "SWE-bench-Live", hint: "rolling GitHub-issue dataset" },
  { id: "pro", name: "SWE-Bench Pro", hint: "multi-file, long-horizon" },
];

export default function BenchmarksPage() {
  const refreshJobs = useRefreshJobs();
  const jobsQuery = useBenchJobs();
  const jobs = jobsQuery.data;
  const anyFetchActive = (jobs ?? []).some((j) => j.kind === "fetch" && isJobActive(j));
  // Dataset counts change when a fetch (or a run's auto-fetch) finishes, so poll while one is in flight.
  const datasetsQuery = useQuery({
    queryKey: ["bench-datasets"],
    queryFn: listDatasets,
    retry: 0,
    staleTime: 0,
    refetchInterval: anyFetchActive || (jobs ?? []).some((j) => j.kind !== "fetch" && isJobActive(j)) ? 3000 : false,
  });

  const [dataset, setDataset] = useState("lite");
  const [baseline, setBaseline] = useState<"gold" | "noop">("gold");
  const [limit, setLimit] = useState(3);
  const [allInstances, setAllInstances] = useState(false);

  const fetchMutation = useMutation({ mutationFn: createFetchJob, onSuccess: refreshJobs });
  const runMutation = useMutation({ mutationFn: createRunJob, onSuccess: refreshJobs });

  const selected = (datasetsQuery.data ?? []).find((d) => d.id === dataset);
  const runnable = selected ? selected.dockerExecutionSupported : true;
  const runActive = activeJob(jobs, (j) => j.kind === "run" && j.dataset === dataset && j.params.baseline === baseline);

  return (
    <div>
      <PageHeader
        title="Benchmarks"
        description="SWE-bench dataset browsing and evaluation runs, served by the separate Python bench service (apps/bench). Fetches and runs execute on the server, so they keep going while you use other pages."
      />
      <div className="space-y-6 p-8">
        {datasetsQuery.error ? (
          <BenchUnavailable error={datasetsQuery.error} />
        ) : datasetsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Checking bench service...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(datasetsQuery.data ?? []).map((d) => {
              const fetching = activeJob(jobs, (j) => j.kind === "fetch" && j.dataset === d.id);
              const fetchingViaRun = activeJob(jobs, (j) => j.kind !== "fetch" && j.dataset === d.id && j.phase === "fetching dataset");
              const busy = !!fetching || !!fetchingViaRun;
              return (
                <Card key={d.id} data-testid={`dataset-${d.id}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-accent" /> {d.name}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">{d.id}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-semibold tabular-nums" data-testid={`count-${d.id}`}>
                        {d.instanceCount}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {busy ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Spinner className="h-3 w-3" /> fetching…
                          </span>
                        ) : d.lastFetchedAt ? (
                          `fetched ${formatDate(d.lastFetchedAt)}`
                        ) : (
                          "not fetched"
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={d.dockerExecutionSupported ? "success" : "secondary"}>
                        {d.dockerExecutionSupported ? "can run in Docker" : "fetch only"}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || fetchMutation.isPending}
                        onClick={() => fetchMutation.mutate(d.id)}
                      >
                        <Download /> {d.instanceCount ? "Re-fetch" : "Fetch"}
                      </Button>
                    </div>
                    {!d.dockerExecutionSupported && d.description ? (
                      <p className="text-xs text-muted-foreground">{d.description}</p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {fetchMutation.isError ? <BenchUnavailable error={fetchMutation.error} /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4" /> Launch a benchmark run
            </CardTitle>
            <CardDescription>
              Runs the Docker harness on the first N instances with the gold (reference patch) or noop (no patch)
              baseline. If the dataset hasn&apos;t been fetched yet it is fetched first.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label>Dataset</Label>
              <Select value={dataset} onValueChange={setDataset}>
                <SelectTrigger aria-label="Dataset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWN_DATASETS.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Baseline</Label>
              <Select value={baseline} onValueChange={(v) => setBaseline(v as "gold" | "noop")}>
                <SelectTrigger aria-label="Baseline">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gold">gold — apply reference patch</SelectItem>
                  <SelectItem value="noop">noop — apply no patch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="run-limit">Instances</Label>
              <Input
                id="run-limit"
                type="number"
                min={1}
                value={limit}
                disabled={allInstances}
                onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={allInstances} onChange={(e) => setAllInstances(e.target.checked)} />
              All instances
            </label>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={!runnable || runMutation.isPending || !!runActive}
                onClick={() => runMutation.mutate({ dataset, baseline, limit: allInstances ? 0 : limit })}
              >
                {runMutation.isPending || runActive ? <Spinner className="text-primary-foreground" /> : <PlayCircle />}
                Run
              </Button>
            </div>
          </CardContent>
          {!runnable ? (
            <CardContent className="pt-0 text-sm text-muted-foreground">
              {selected?.name} can be fetched but not executed: {selected?.description}
            </CardContent>
          ) : null}
          {runMutation.isError ? (
            <CardContent className="pt-0">
              <BenchUnavailable error={runMutation.error} />
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
            <CardDescription>Fetches, runs and evaluations. Updates live; safe to leave this page.</CardDescription>
          </CardHeader>
          <CardContent>
            {jobsQuery.error ? (
              <BenchUnavailable error={jobsQuery.error} />
            ) : (
              <JobList jobs={jobs ?? []} empty="No jobs yet. Fetch a dataset or launch a run." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
