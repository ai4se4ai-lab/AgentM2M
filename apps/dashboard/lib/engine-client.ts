import type { Team } from "@agentm2m/schema";
import { serviceUrl } from "./service-urls";

// Resolved per call: the right address differs between the browser and SSR (see service-urls.ts).
export const engineUrl = () =>
  serviceUrl({
    explicit: process.env.NEXT_PUBLIC_ENGINE_URL,
    port: process.env.NEXT_PUBLIC_ENGINE_PORT,
    defaultPort: 4000,
    internal: process.env.ENGINE_INTERNAL_URL,
  });

export class EngineError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "EngineError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${engineUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch (err) {
    throw new EngineError(
      `Could not reach the engine at ${engineUrl()}${path}. Is it running?`,
      0,
      err instanceof Error ? err.message : String(err),
    );
  }
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in (body as Record<string, unknown>)
        ? JSON.stringify((body as Record<string, unknown>).error)
        : `${res.status} ${res.statusText}`;
    throw new EngineError(message, res.status, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- Teams -----------------------------------------------------------------

export interface TeamSummary {
  id: string;
  name: string;
}

export function listTeams(): Promise<TeamSummary[]> {
  return request<TeamSummary[]>("/api/teams");
}

export function getTeam(id: string): Promise<Team> {
  return request<Team>(`/api/teams/${encodeURIComponent(id)}`);
}

export function createTeam(team: Team): Promise<Team> {
  return request<Team>("/api/teams", { method: "POST", body: JSON.stringify(team) });
}

export function updateTeam(id: string, team: Team): Promise<Team> {
  return request<Team>(`/api/teams/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(team) });
}

// ---- Models / Ollama ---------------------------------------------------------

export interface OllamaHost {
  id: string;
  name: string;
  url: string;
}

export interface OllamaModelInfo {
  name: string;
  size?: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
    format?: string;
  };
  [key: string]: unknown;
}

export interface TestConnectionResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export function listOllamaHosts(): Promise<OllamaHost[]> {
  return request<OllamaHost[]>("/api/models/ollama/hosts");
}

export function addOllamaHost(input: { name: string; url: string }): Promise<OllamaHost> {
  return request<OllamaHost>("/api/models/ollama/hosts", { method: "POST", body: JSON.stringify(input) });
}

export function listOllamaHostModels(hostId: string): Promise<OllamaModelInfo[]> {
  return request<OllamaModelInfo[]>(`/api/models/ollama/hosts/${encodeURIComponent(hostId)}/models`);
}

export function testConnection(url: string): Promise<TestConnectionResult> {
  return request<TestConnectionResult>("/api/models/test-connection", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

// ---- Runs --------------------------------------------------------------------

export type RunStatus = "running" | "succeeded" | "failed" | "budget_exhausted";

export interface RunSummary {
  id: string;
  teamId: string;
  status: RunStatus;
  createdAt: string;
}

export interface TraceEvent {
  runId?: string;
  seq?: number;
  ts?: string;
  algorithm: "RunTeam" | "Lift" | "GuardedRestore" | "Propagate" | "Adapt";
  step: string;
  agentId?: string;
  edgeId?: string;
  detail?: Record<string, unknown>;
}

export interface RunTeamResult {
  artifact: string;
  accepted: boolean;
  sigma: Record<string, { model: unknown; version: number }>;
  team: Team;
  cost: number;
  iterations: number;
  escalations: { edgeId: string; diagnostics: string[] }[];
}

export interface RunDetail {
  id: string;
  teamId: string;
  task: string;
  status: RunStatus;
  events: TraceEvent[];
  result?: RunTeamResult;
  error?: string;
  createdAt: string;
}

export function listRuns(): Promise<RunSummary[]> {
  return request<RunSummary[]>("/api/runs");
}

export function getRun(id: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
}

export function startRun(input: { teamId: string; task: string; budget?: number }): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>("/api/runs", { method: "POST", body: JSON.stringify(input) });
}

export function runEventsWsUrl(runId: string): string {
  const wsBase = engineUrl().replace(/^http/, "ws");
  return `${wsBase}/api/runs/${encodeURIComponent(runId)}/events`;
}
