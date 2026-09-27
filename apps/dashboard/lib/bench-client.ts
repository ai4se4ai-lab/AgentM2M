/**
 * Client for the `apps/bench` Python FastAPI service. Bench's real contract
 * (apps/bench/app/main.py) differs in shape from the dashboard's view models,
 * so each call below adapts the response. Failures surface as
 * BenchUnavailableError so pages can render a "service unavailable" state.
 */

import { serviceUrl } from "./service-urls";

// Resolved per call: the right address differs between the browser and SSR (see service-urls.ts).
export const benchUrl = () =>
  serviceUrl({
    explicit: process.env.NEXT_PUBLIC_BENCH_URL,
    port: process.env.NEXT_PUBLIC_BENCH_PORT,
    defaultPort: 8000,
    internal: process.env.BENCH_INTERNAL_URL,
  });

export class BenchUnavailableError extends Error {
  reason: "unreachable" | "http_error";
  status?: number;
  /** FastAPI's `detail` string for http errors, when bench sent one. */
  detail?: string;
  constructor(message: string, reason: "unreachable" | "http_error", status?: number, detail?: string) {
    super(message);
    this.detail = detail;
    this.name = "BenchUnavailableError";
    this.reason = reason;
    this.status = status;
  }
}

async function benchRequest<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${benchUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new BenchUnavailableError(
      `Bench service unreachable at ${benchUrl()}${path}`,
      "unreachable",
    );
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : body?.detail ? JSON.stringify(body.detail) : undefined;
    } catch {
      /* non-JSON error body */
    }
    throw new BenchUnavailableError(
      `Bench service returned ${res.status} for ${path}${detail ? `: ${detail}` : ""}`,
      "http_error",
      res.status,
      detail,
    );
  }
  return (await res.json()) as T;
}

export interface DatasetCard {
  id: string;
  name: string;
  instanceCount: number;
  lastFetchedAt?: string;
  description?: string;
  /** false for datasets bench can fetch but not execute in Docker (live, pro). */
  dockerExecutionSupported: boolean;
}

export interface HypothesisStatus {
  id: string;
  text: string;
  test: string;
  result: "supported" | "not_supported" | "pending";
  effect?: string;
  ci?: string;
}

export interface RqResult {
  rq: string;
  rows: Record<string, unknown>[];
}

// GET /api/benchmarks -> [{ name, label, available, instanceCount|null, note }]
export async function listDatasets(): Promise<DatasetCard[]> {
  const raw = await benchRequest<
    {
      name: string;
      label: string;
      instanceCount: number | null;
      fetchedAt: string | null;
      dockerExecutionSupported: boolean;
      note: string | null;
    }[]
  >("/api/benchmarks");
  return raw.map((d) => ({
    id: d.name,
    name: d.label,
    instanceCount: d.instanceCount ?? 0,
    description: d.note ?? undefined,
    lastFetchedAt: d.fetchedAt ?? undefined,
    dockerExecutionSupported: d.dockerExecutionSupported,
  }));
}

// ---- Background jobs -------------------------------------------------------
// Fetching datasets and running the Docker harness can take minutes to hours,
// so bench runs them server-side as jobs. These calls return immediately; the
// UI polls listJobs(). Because the work lives on the server, navigating between
// dashboard pages never interrupts it.

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobInstanceResult {
  status: "ran" | "skipped" | "error";
  resolved?: boolean;
  patch_successfully_applied?: boolean;
  duration_s?: number;
  reason?: string;
  FAIL_TO_PASS?: { passed: number; failed: number };
  PASS_TO_PASS?: { passed: number; failed: number };
}

export interface BenchJob {
  id: string;
  kind: "fetch" | "run" | "evaluate";
  dataset: string;
  params: Record<string, unknown>;
  status: JobStatus;
  phase: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: { done: number; total: number; current: string | null };
  results: Record<string, JobInstanceResult>;
  summary: Record<string, any> | null;
  error: string | null;
  cancelRequested: boolean;
}

export const isJobActive = (j: Pick<BenchJob, "status">) => j.status === "queued" || j.status === "running";

const post = <T>(path: string, body?: unknown) =>
  benchRequest<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const listJobs = () => benchRequest<BenchJob[]>("/api/jobs");

export const createFetchJob = (dataset: string) => post<BenchJob>("/api/jobs/fetch", { dataset });

/** `limit` 0 = every instance in the dataset. */
export const createRunJob = (input: { dataset: string; baseline: "gold" | "noop"; limit: number }) =>
  post<BenchJob>("/api/jobs/run", input);

export const createEvaluateJob = (input: { rq: "rq1" | "rq3"; dataset: string; limit: number }) =>
  post<BenchJob>("/api/jobs/evaluate", input);

export const cancelJob = (id: string) => post<BenchJob>(`/api/jobs/${encodeURIComponent(id)}/cancel`);

// GET /api/evaluation/rq1 | rq3 -> { computed, baselines | computed[] , note }.
// RQ2/4/5/6 have no bench endpoint (404) and are reported as "no results yet".
export async function getRqResult(rq: string): Promise<RqResult> {
  let raw: Record<string, any>;
  try {
    raw = await benchRequest<Record<string, any>>(`/api/evaluation/${rq}`);
  } catch (err) {
    if (err instanceof BenchUnavailableError && err.status === 404) return { rq, rows: [] };
    throw err;
  }
  if (raw.computed === false) return { rq, rows: [] };
  if (raw.baselines && typeof raw.baselines === "object") {
    return {
      rq,
      rows: Object.entries(raw.baselines as Record<string, Record<string, unknown>>).map(([baseline, m]) => ({
        baseline,
        n_ran: m.n_ran,
        n_resolved: m.n_resolved,
        resolve_rate: m.resolve_rate,
      })),
    };
  }
  if (Array.isArray(raw.computed)) {
    return {
      rq,
      rows: raw.computed.flatMap((c: any) =>
        Object.entries((c.by_baseline ?? {}) as Record<string, Record<string, unknown>>).map(([baseline, m]) => ({
          ablation: c.id,
          baseline,
          strict_resolve_rate: m.strict_resolve_rate,
          f2p_only_resolve_rate: m.f2p_only_resolve_rate,
          n_ran: m.n_ran,
        })),
      ),
    };
  }
  return { rq, rows: [] };
}

// GET /api/evaluation/hypotheses -> [{ id, text, status, note }]
export async function getHypotheses(): Promise<HypothesisStatus[]> {
  const raw = await benchRequest<{ id: string; text: string; status: string; note?: string }[]>(
    "/api/evaluation/hypotheses",
  );
  return raw.map((h) => ({
    id: h.id,
    text: h.text,
    test: h.note ?? h.status.replace(/_/g, " "),
    result: h.status === "supported" || h.status === "not_supported" ? h.status : "pending",
  }));
}
