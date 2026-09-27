import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Team } from "@agentm2m/schema";
import type { RunTeamResult, TraceEvent } from "../algorithms/run-team.js";

export interface OllamaHostRecord {
  id: string;
  name: string;
  url: string;
}

export type RunStatus = "running" | "succeeded" | "failed" | "budget_exhausted";

export interface RunRecord {
  id: string;
  teamId: string;
  task: string;
  status: RunStatus;
  events: TraceEvent[];
  result?: RunTeamResult;
  error?: string;
  createdAt: string;
  subscribers: Set<(event: TraceEvent) => void>;
}

/**
 * In-memory store with JSON-file persistence for teams/hosts. docs/dev.md
 * calls for Postgres + Prisma; this prototype pass uses a single-process
 * store instead — @agentm2m/schema's zod types are the Prisma-ready
 * boundary, so swapping the persistence layer later doesn't touch the
 * domain model or the algorithms.
 */
export class Store {
  readonly teams = new Map<string, Team>();
  readonly ollamaHosts = new Map<string, OllamaHostRecord>();
  readonly runs = new Map<string, RunRecord>();
  private readonly dataDir: string;

  constructor(dataDir = process.env.DATA_DIR ?? "./data") {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  private teamsFile(): string {
    return join(this.dataDir, "teams.json");
  }
  private hostsFile(): string {
    return join(this.dataDir, "ollama-hosts.json");
  }

  private load(): void {
    if (existsSync(this.teamsFile())) {
      const arr = JSON.parse(readFileSync(this.teamsFile(), "utf-8")) as Team[];
      for (const t of arr) this.teams.set(t.id, t);
    }
    if (existsSync(this.hostsFile())) {
      const arr = JSON.parse(readFileSync(this.hostsFile(), "utf-8")) as OllamaHostRecord[];
      for (const h of arr) this.ollamaHosts.set(h.id, h);
    }
  }

  saveTeams(): void {
    writeFileSync(this.teamsFile(), JSON.stringify([...this.teams.values()], null, 2));
  }

  saveHosts(): void {
    writeFileSync(this.hostsFile(), JSON.stringify([...this.ollamaHosts.values()], null, 2));
  }
}
