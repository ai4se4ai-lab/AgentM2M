import { useEffect, useState } from "react";
import type { EdgeDef, ModelObject, Team } from "@agentm2m/schema";
import type { TraceEvent } from "@/lib/engine-client";

export type AgentStatus = "idle" | "working" | "lifted" | "restored" | "failed";

export interface ActivityEntry {
  index: number;
  event: TraceEvent;
  /** One-line, human-readable rendering of the event. */
  summary: string;
}

export interface AgentLive {
  status: AgentStatus;
  turns: number;
  liftOk: number;
  liftFail: number;
  restores: number;
  /** The agent's current model, rebuilt by replaying every Lift diff. */
  objects: ModelObject[];
  lastKind?: string;
  activity: ActivityEntry[];
}

export interface EdgeLive {
  restores: number;
  changedRestores: number;
  /** Which endpoint was restored by the most recent Propagate on this edge. */
  lastRestoreSide?: "source" | "target";
  activity: ActivityEntry[];
}

export interface LiveState {
  agents: Record<string, AgentLive>;
  edges: Record<string, EdgeLive>;
  /** Latest event shown so far, or null before the run starts. */
  focus: ActivityEntry | null;
  /** Agent / edge that the latest event is about; drives the glow + particles. */
  activeAgentId?: string;
  activeEdgeId?: string;
  adaptations: ActivityEntry[];
  finished: boolean;
  accepted?: boolean;
  /** Set when the run died (engine error) before emitting RunTeam/done. */
  crashed?: string;
  eventCount: number;
}

export function summarize(evt: TraceEvent): string {
  const d = evt.detail ?? {};
  switch (`${evt.algorithm}/${evt.step}`) {
    case "RunTeam/init":
      return `Run started with ${Array.isArray(d.agents) ? d.agents.length : "?"} agents`;
    case "RunTeam/schedule":
      return `${evt.agentId} scheduled for a ${String(d.kind ?? "task")} turn`;
    case "RunTeam/done":
      return `Run finished · accepted=${String(d.accepted)} · ${String(d.iterations)} iterations · cost ${String(d.cost)}`;
    case "Lift/ok": {
      const diff = d.diff as { added?: unknown[]; removed?: unknown[]; changed?: unknown[] } | undefined;
      const a = diff?.added?.length ?? 0;
      const c = diff?.changed?.length ?? 0;
      const r = diff?.removed?.length ?? 0;
      return `${evt.agentId} lifted a response into its model (+${a} ~${c} −${r})`;
    }
    case "Lift/fail":
      return `${evt.agentId} response could not be lifted into a valid model`;
    case "Propagate/restore":
      return `Edge ${evt.edgeId} restored the ${String(d.restoreSide)} side${d.changed ? " (model changed)" : " (no change)"}`;
    case "Adapt/applied": {
      const rule = d.rule;
      return `Adaptation applied: ${typeof rule === "string" ? rule : JSON.stringify(rule)}`;
    }
    default:
      return `${evt.algorithm} · ${evt.step}`;
  }
}

/**
 * Mirrors the engine's `insert_agent` delta (apps/engine/src/algorithms/adapt.ts)
 * so an agent inserted mid-run shows up on the canvas the moment its Adapt
 * event is played, rather than only once the run's final team is fetched.
 */
export function applyAdaptations(team: Team, appliedRuleIds: string[]): Team {
  let next = team;
  for (const ruleId of appliedRuleIds) {
    const rule = next.adaptationRules.find((r) => r.id === ruleId);
    if (!rule || rule.action !== "insert_agent") continue;
    const params = rule.params as {
      agent?: Team["agents"][number];
      connections?: { existingAgentId: string; edgeId: string; omega?: EdgeDef["omega"] }[];
    };
    const agent = params.agent;
    if (!agent || !params.connections || next.agents.some((a) => a.id === agent.id)) continue;
    const newEdges: EdgeDef[] = params.connections.map((c) => ({
      id: c.edgeId,
      source: c.existingAgentId,
      target: agent.id,
      omega: c.omega ?? "->",
      structuralRule: { checks: [] },
      oracle: { kind: "executable", executable: { command: "true" } },
      budgets: { k: 2, l: 2 },
    }));
    next = { ...next, agents: [...next.agents, agent], edges: [...next.edges, ...newEdges] };
  }
  return next;
}

function emptyAgent(): AgentLive {
  return { status: "idle", turns: 0, liftOk: 0, liftFail: 0, restores: 0, objects: [], activity: [] };
}

interface Diff {
  added?: ModelObject[];
  removed?: ModelObject[];
  changed?: { id: string; after: ModelObject }[];
}

function applyDiff(objects: ModelObject[], diff: Diff | undefined): ModelObject[] {
  if (!diff) return objects;
  const removed = new Set((diff.removed ?? []).map((o) => o.id));
  const changed = new Map((diff.changed ?? []).map((c) => [c.id, c.after]));
  const next = objects.filter((o) => !removed.has(o.id)).map((o) => changed.get(o.id) ?? o);
  return [...next, ...(diff.added ?? [])];
}

/**
 * Pure fold of the trace stream into per-agent / per-edge state. Agent ids that
 * appear only in events (e.g. an agent inserted by Adapt) are tracked too, so
 * callers can render them once the run's final team is known.
 */
export function deriveLiveState(team: Team, events: TraceEvent[], crash?: { error?: string }): LiveState {
  const agents: Record<string, AgentLive> = Object.fromEntries(team.agents.map((a) => [a.id, emptyAgent()]));
  const edges: Record<string, EdgeLive> = Object.fromEntries(
    team.edges.map((e) => [e.id, { restores: 0, changedRestores: 0, activity: [] }]),
  );
  const state: LiveState = {
    agents,
    edges,
    focus: null,
    adaptations: [],
    finished: false,
    eventCount: events.length,
  };

  events.forEach((event, index) => {
    const entry: ActivityEntry = { index, event, summary: summarize(event) };
    state.focus = entry;
    state.activeAgentId = undefined;
    state.activeEdgeId = undefined;

    const agent = event.agentId ? (agents[event.agentId] ??= emptyAgent()) : undefined;
    if (agent) agent.activity.push(entry);
    const edge = event.edgeId ? (edges[event.edgeId] ??= { restores: 0, changedRestores: 0, activity: [] }) : undefined;
    if (edge) edge.activity.push(entry);

    switch (`${event.algorithm}/${event.step}`) {
      case "RunTeam/schedule":
        if (agent) {
          agent.status = "working";
          agent.turns += 1;
          agent.lastKind = String(event.detail?.kind ?? "task");
          state.activeAgentId = event.agentId;
        }
        break;
      case "Lift/ok":
        if (agent) {
          agent.status = "lifted";
          agent.liftOk += 1;
          agent.objects = applyDiff(agent.objects, event.detail?.diff as Diff | undefined);
          state.activeAgentId = event.agentId;
        }
        break;
      case "Lift/fail":
        if (agent) {
          agent.status = "failed";
          agent.liftFail += 1;
          state.activeAgentId = event.agentId;
        }
        break;
      case "Propagate/restore": {
        if (!edge) break;
        edge.restores += 1;
        const side = event.detail?.restoreSide === "source" ? "source" : "target";
        edge.lastRestoreSide = side;
        if (event.detail?.changed) edge.changedRestores += 1;
        state.activeEdgeId = event.edgeId;
        const def = team.edges.find((e) => e.id === event.edgeId);
        const restored = def ? (side === "source" ? def.source : def.target) : undefined;
        if (restored && agents[restored]) {
          agents[restored].restores += 1;
          agents[restored].status = "restored";
          agents[restored].activity.push(entry);
          state.activeAgentId = restored;
        }
        break;
      }
      case "Adapt/applied":
        state.adaptations.push(entry);
        break;
      case "RunTeam/done":
        state.finished = true;
        state.accepted = Boolean(event.detail?.accepted);
        state.activeAgentId = undefined;
        for (const a of Object.values(agents)) if (a.status === "working") a.status = "idle";
        break;
    }
  });

  if (crash && !state.finished) {
    state.finished = true;
    state.crashed = crash.error ?? "Run failed";
    state.activeAgentId = undefined;
    state.activeEdgeId = undefined;
    for (const a of Object.values(agents)) if (a.status === "working") a.status = "failed";
  }

  return state;
}

/**
 * Paces a burst of events for the canvas. Events arrive in batches (the
 * server replays history on connect, and Lift/Propagate steps can land within
 * milliseconds), which would otherwise flash by unseen. While `live`, the
 * returned count advances one event per `stepMs` until it catches up; when
 * not live it jumps straight to the full history.
 */
export function usePlayedCount(total: number, live: boolean, stepMs = 450): number {
  const [count, setCount] = useState(live ? 0 : total);

  useEffect(() => {
    if (!live) {
      setCount(total);
      return;
    }
    if (count > total) {
      setCount(total);
      return;
    }
    if (count === total) return;
    const timer = setTimeout(() => setCount((c) => Math.min(c + 1, total)), stepMs);
    return () => clearTimeout(timer);
  }, [count, total, live, stepMs]);

  return count;
}
