"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isJobActive, listJobs, type BenchJob } from "@/lib/bench-client";

export const BENCH_JOBS_KEY = ["bench-jobs"] as const;

/**
 * Bench jobs (fetch / run / evaluate), polled from the bench service.
 *
 * The jobs live on the server, so this is safe to mount on any page (and in
 * the sidebar): leaving a page never stops a job, and coming back shows its
 * current state immediately from the shared query cache. Polls quickly while
 * something is active and slowly otherwise.
 */
export function useBenchJobs() {
  return useQuery({
    queryKey: BENCH_JOBS_KEY,
    queryFn: listJobs,
    retry: 0,
    staleTime: 0,
    refetchInterval: (q) => ((q.state.data ?? []).some(isJobActive) ? 2000 : 10_000),
  });
}

export function useActiveJobCount(): number {
  const { data } = useBenchJobs();
  return (data ?? []).filter(isJobActive).length;
}

/** Call after creating a job so it shows up without waiting for the next poll. */
export function useRefreshJobs() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: BENCH_JOBS_KEY });
}

export function activeJob(jobs: BenchJob[] | undefined, match: (j: BenchJob) => boolean): BenchJob | undefined {
  return (jobs ?? []).find((j) => isJobActive(j) && match(j));
}
