import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { TeamSchema, type Team } from "@agentm2m/schema";
import { Store, type OllamaHostRecord } from "../store/store.js";
import { ModelRouter } from "../model-router/router.js";
import { OllamaProvider } from "../model-router/ollama.provider.js";
import { RouterAgentClient } from "../model-router/agent-client.js";
import { makeOracleDispatcher } from "../model-router/oracle-dispatch.js";
import { runTeam, type TraceEvent } from "../algorithms/run-team.js";
import { devTeam } from "../seed/devteam.js";

export interface BuildServerOptions {
  dataDir?: string;
}

export function buildServer(opts: BuildServerOptions = {}) {
  const app = Fastify({ logger: false });
  const store = new Store(opts.dataDir);
  if (store.teams.size === 0) {
    store.teams.set(devTeam.id, devTeam);
    store.saveTeams();
  }
  const router = new ModelRouter().register("ollama", new OllamaProvider());
  const evaluateOracle = makeOracleDispatcher(router);

  app.register(cors, { origin: true });
  app.register(websocket);

  app.get("/api/health", async () => ({ ok: true }));

  // --- Teams --------------------------------------------------------------
  app.get("/api/teams", async () => [...store.teams.values()].map((t) => ({ id: t.id, name: t.name })));

  app.get("/api/teams/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const team = store.teams.get(id);
    if (!team) return reply.code(404).send({ error: "not found" });
    return team;
  });

  app.post("/api/teams", async (req, reply) => {
    const parsed = TeamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    store.teams.set(parsed.data.id, parsed.data);
    store.saveTeams();
    return reply.code(201).send(parsed.data);
  });

  app.put("/api/teams/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = TeamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.id !== id) return reply.code(400).send({ error: "id mismatch" });
    store.teams.set(id, parsed.data);
    store.saveTeams();
    return parsed.data;
  });

  // --- Model registry -------------------------------------------------------
  app.post("/api/models/ollama/hosts", async (req, reply) => {
    const body = req.body as { name?: string; url?: string };
    if (!body?.name || !body?.url) return reply.code(400).send({ error: "name and url are required" });
    if (!/^https?:\/\//.test(body.url)) return reply.code(400).send({ error: "url must be http(s)" });
    const record: OllamaHostRecord = { id: randomUUID(), name: body.name, url: body.url };
    store.ollamaHosts.set(record.id, record);
    store.saveHosts();
    return reply.code(201).send(record);
  });

  app.get("/api/models/ollama/hosts", async () => [...store.ollamaHosts.values()]);

  app.get("/api/models/ollama/hosts/:id/models", async (req, reply) => {
    const { id } = req.params as { id: string };
    const host = store.ollamaHosts.get(id);
    if (!host) return reply.code(404).send({ error: "not found" });
    try {
      const models = await OllamaProvider.listModels(host.url);
      return models;
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/models/test-connection", async (req, reply) => {
    const body = req.body as { url?: string };
    if (!body?.url || !/^https?:\/\//.test(body.url)) return reply.code(400).send({ error: "url must be http(s)" });
    return OllamaProvider.testConnection(body.url);
  });

  // --- Runs -----------------------------------------------------------------
  app.post("/api/runs", async (req, reply) => {
    const body = req.body as { teamId?: string; task?: string; budget?: number };
    if (!body?.teamId || !body?.task) return reply.code(400).send({ error: "teamId and task are required" });
    const team = store.teams.get(body.teamId);
    if (!team) return reply.code(404).send({ error: "team not found" });

    const runId = randomUUID();
    store.runs.set(runId, {
      id: runId,
      teamId: team.id,
      task: body.task,
      status: "running",
      events: [],
      createdAt: new Date().toISOString(),
      subscribers: new Set(),
    });
    reply.code(202).send({ id: runId, status: "running" });

    void executeRun(store, router, evaluateOracle, team, runId, body.task, body.budget ?? 20);
  });

  app.get("/api/runs", async () =>
    [...store.runs.values()].map((r) => ({ id: r.id, teamId: r.teamId, status: r.status, createdAt: r.createdAt })),
  );

  app.get("/api/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = store.runs.get(id);
    if (!run) return reply.code(404).send({ error: "not found" });
    const { subscribers, ...rest } = run;
    return rest;
  });

  app.register(async (instance) => {
    instance.get("/api/runs/:id/events", { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string };
      const run = store.runs.get(id);
      if (!run) {
        socket.close();
        return;
      }
      for (const evt of run.events) socket.send(JSON.stringify(evt));
      const listener = (evt: TraceEvent) => socket.send(JSON.stringify(evt));
      run.subscribers.add(listener);
      socket.on("close", () => run.subscribers.delete(listener));
    });
  });

  return { app, store, router };
}

async function executeRun(
  store: Store,
  router: ModelRouter,
  evaluateOracle: ReturnType<typeof makeOracleDispatcher>,
  team: Team,
  runId: string,
  task: string,
  budget: number,
): Promise<void> {
  const run = store.runs.get(runId);
  if (!run) return;

  const client = new RouterAgentClient({
    router,
    agentBindings: Object.fromEntries(team.agents.map((a) => [a.id, a.modelBinding])),
    agentMetamodels: Object.fromEntries(team.agents.map((a) => [a.id, a.metamodel])),
    agentSystemPrompts: Object.fromEntries(team.agents.map((a) => [a.id, a.systemPrompt ?? ""])),
  });

  try {
    const result = await runTeam({
      task,
      team,
      phi: () => false, // no generic acceptance predicate without a task-specific check; the run always spends its budget and returns a best-effort artifact
      budget,
      client,
      evaluateOracle,
      onEvent: (evt) => {
        run.events.push(evt);
        for (const sub of run.subscribers) sub(evt);
      },
    });
    run.status = result.accepted ? "succeeded" : "budget_exhausted";
    run.result = result;
  } catch (err) {
    run.status = "failed";
    run.error = err instanceof Error ? err.message : String(err);
  }
}
