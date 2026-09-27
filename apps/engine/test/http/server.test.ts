import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Team } from "@agentm2m/schema";
import { buildServer } from "../../src/http/server.js";

let dataDir: string;
let app: ReturnType<typeof buildServer>["app"];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "agentm2m-store-"));
  app = buildServer({ dataDir }).app;
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function minimalTeam(id = "t1"): Team {
  return {
    id,
    name: "Test Team",
    agents: [
      {
        id: "A",
        role: "A",
        metamodel: { agentRole: "A", classes: [{ name: "Item", attributes: [], references: [] }], constraints: [] },
        modelBinding: { provider: "ollama", modelId: "qwen2.5:3b", temperature: 0.2, maxTokens: 512 },
        tools: [],
      },
    ],
    edges: [],
    adaptationRules: [],
    thresholds: { theta: 2, aMax: 3 },
  };
}

describe("engine HTTP API", () => {
  it("reports healthy", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("rejects a team that doesn't conform to MM_Team", async () => {
    const res = await app.inject({ method: "POST", url: "/api/teams", payload: { id: "bad" } });
    expect(res.statusCode).toBe(400);
  });

  it("creates, lists, fetches, and updates a team", async () => {
    const team = minimalTeam();
    const create = await app.inject({ method: "POST", url: "/api/teams", payload: team });
    expect(create.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/api/teams" });
    expect(list.json()).toContainEqual({ id: "t1", name: "Test Team" });

    const fetched = await app.inject({ method: "GET", url: "/api/teams/t1" });
    expect(fetched.json().name).toBe("Test Team");

    const updated = { ...team, name: "Renamed Team" };
    const put = await app.inject({ method: "PUT", url: "/api/teams/t1", payload: updated });
    expect(put.statusCode).toBe(200);
    const refetched = await app.inject({ method: "GET", url: "/api/teams/t1" });
    expect(refetched.json().name).toBe("Renamed Team");
  });

  it("404s a missing team", async () => {
    const res = await app.inject({ method: "GET", url: "/api/teams/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("persists teams across a fresh Store instance pointed at the same data dir", async () => {
    await app.inject({ method: "POST", url: "/api/teams", payload: minimalTeam("persisted") });
    const second = buildServer({ dataDir }).app;
    const res = await second.inject({ method: "GET", url: "/api/teams/persisted" });
    expect(res.statusCode).toBe(200);
    await second.close();
  });

  it("validates the model registry's Ollama host URL scheme", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/models/ollama/hosts", payload: { name: "x", url: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({ method: "POST", url: "/api/models/ollama/hosts", payload: { name: "local", url: "http://localhost:11434" } });
    expect(good.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/models/ollama/hosts" });
    expect(list.json()).toHaveLength(1);
  });

  it("404s starting a run against a team that doesn't exist", async () => {
    const res = await app.inject({ method: "POST", url: "/api/runs", payload: { teamId: "nope", task: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("accepts a run request and reflects it as running immediately", async () => {
    await app.inject({ method: "POST", url: "/api/teams", payload: minimalTeam() });
    const res = await app.inject({ method: "POST", url: "/api/runs", payload: { teamId: "t1", task: "do something", budget: 0 } });
    expect(res.statusCode).toBe(202);
    const { id } = res.json();
    const status = await app.inject({ method: "GET", url: `/api/runs/${id}` });
    expect(["running", "succeeded", "budget_exhausted", "failed"]).toContain(status.json().status);
  });
});
