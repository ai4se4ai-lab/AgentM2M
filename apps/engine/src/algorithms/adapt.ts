import { TeamSchema, type AdaptationRule, type AttributeValue, type EdgeDef, type Team } from "@agentm2m/schema";
import { propagate, type Escalation, type Sigma } from "./propagate.js";
import { hot, validateEdgeRule, type TemplateLibrary } from "./hot.js";
import type { Hole } from "./structural-rule.js";

export interface AdaptParams {
  team: Team;
  sigma: Sigma;
  /** K: monitored events, as simple string tags (e.g. "regression_uncovered", "lift_fail:AR") */
  events: string[];
  priorEscalations: Escalation[];
  adaptationCount: number;
  templates: TemplateLibrary;
  fillHoles: (edge: EdgeDef, holes: Hole[], diagnostics: string[]) => Promise<Record<string, AttributeValue>>;
  evaluateOracle: (edge: EdgeDef, sourceModel: Sigma[string]["model"], targetModel: Sigma[string]["model"]) => Promise<boolean>;
}

export interface AdaptResult {
  team: Team;
  sigma: Sigma;
  escalations: Escalation[];
  adaptationCount: number;
  events: string[];
  applied?: string;
}

/** cond_lambda(K, team): "count(tag) >= n" over the monitored event log, the MVP condition DSL (docs/dev.md §6.1). */
function evaluateCondition(condition: string, events: string[]): { holds: boolean; tag?: string } {
  const match = /^count\((\w[\w:.-]*)\)\s*>=\s*(\d+)$/.exec(condition.trim());
  if (!match) return { holds: false };
  const [, tag, thresholdStr] = match;
  const count = events.filter((e) => e === tag).length;
  return { holds: count >= Number(thresholdStr), tag };
}

function teamConforms(team: Team): boolean {
  return TeamSchema.safeParse(team).success;
}

function changedOrNewEdges(before: Team, after: Team): EdgeDef[] {
  const beforeById = new Map(before.edges.map((e) => [e.id, e]));
  return after.edges.filter((e) => {
    const prev = beforeById.get(e.id);
    return !prev || prev.source !== e.source || prev.target !== e.target;
  });
}

/**
 * delta_lambda(team): the only adaptation action implemented end-to-end in
 * this prototype is `insert_agent` (the paper's concrete
 * insert-impact-analyst scenario). `split_role`/`switch_backend`/`custom`
 * are represented in the schema for future work but delta returns null for
 * them here — a documented scope simplification (docs/dev.md's "faithful
 * core slice"), not a silent no-op: Adapt will just keep trying the next
 * rule in Lambda by priority.
 */
function delta(rule: AdaptationRule, team: Team): Team | null {
  if (rule.action !== "insert_agent") return null;
  const params = rule.params as {
    agent?: Team["agents"][number];
    connections?: { existingAgentId: string; edgeId: string; omega?: EdgeDef["omega"] }[];
  };
  if (!params.agent || !params.connections) return null;
  if (team.agents.some((a) => a.id === params.agent!.id)) return null; // already inserted

  const newEdges: EdgeDef[] = params.connections.map((c) => ({
    id: c.edgeId,
    source: c.existingAgentId,
    target: params.agent!.id,
    omega: c.omega ?? "->",
    structuralRule: { checks: [] },
    oracle: { kind: "executable", executable: { command: "true" } },
    budgets: { k: 2, l: 2 },
  }));

  return {
    ...team,
    agents: [...team.agents, params.agent],
    edges: [...team.edges, ...newEdges],
  };
}

/** mu(sigma, team, team'): copy retained models/ids verbatim; initialize new agents empty. */
function mu(sigma: Sigma, before: Team, after: Team): Sigma {
  const next: Sigma = { ...sigma };
  for (const agent of after.agents) {
    if (!next[agent.id]) next[agent.id] = { model: { objects: [] }, version: 0 };
  }
  return next;
}

async function tryAdaptation(
  rule: AdaptationRule,
  team: Team,
  sigma: Sigma,
  escalations: Escalation[],
  templates: TemplateLibrary,
  fillHoles: AdaptParams["fillHoles"],
  evaluateOracle: AdaptParams["evaluateOracle"],
): Promise<{ team: Team; sigma: Sigma; escalations: Escalation[] } | null> {
  const team2 = delta(rule, team);
  if (!team2 || !teamConforms(team2)) return null;

  const newAgentIds = new Set(team2.agents.map((a) => a.id).filter((id) => !team.agents.some((a) => a.id === id)));
  const affected = changedOrNewEdges(team, team2);
  const metamodelById = new Map(team2.agents.map((a) => [a.id, a.metamodel]));

  for (const edge of affected) {
    const sourceMM = metamodelById.get(edge.source);
    const targetMM = metamodelById.get(edge.target);
    if (!sourceMM || !targetMM) return null;
    edge.structuralRule = hot(templates, sourceMM, targetMM);
    if (!validateEdgeRule(edge.structuralRule, sourceMM, targetMM)) return null;
  }

  const sigma2 = mu(sigma, team, team2);
  const { sigma: sigma3, escalations: newEscalations } = await propagate({
    team: team2,
    sigma: sigma2,
    changedAgents: newAgentIds,
    priorEscalations: escalations,
    metamodels: Object.fromEntries(metamodelById),
    fillHoles,
    evaluateOracle,
    restrictOverwriteTo: newAgentIds,
  });

  const affectedIds = new Set(affected.map((e) => e.id));
  if (newEscalations.some((esc) => affectedIds.has(esc.edgeId))) return null; // C3 violated -> rollback

  return { team: team2, sigma: sigma3, escalations: newEscalations };
}

/**
 * Adapt (Algorithm 5, L1-L2): evaluate Lambda by priority; on a satisfied
 * condition, attempt the transformation transactionally via Try, committing
 * only if the team stays conforming and every affected edge ends
 * checked-consistent (Proposition IV.3). Rejections roll back and record
 * `rejected(lambda)` so the same rule doesn't loop forever within one run.
 */
export async function adapt(params: AdaptParams): Promise<AdaptResult> {
  const { team, sigma, priorEscalations, templates, fillHoles, evaluateOracle } = params;
  let events = params.events;

  if (params.adaptationCount >= team.thresholds.aMax) {
    return { team, sigma, escalations: priorEscalations, adaptationCount: params.adaptationCount, events };
  }

  const rulesByPriority = [...team.adaptationRules].sort((a, b) => b.priority - a.priority);
  for (const rule of rulesByPriority) {
    const { holds, tag } = evaluateCondition(rule.condition, events);
    if (!holds) continue;

    const result = await tryAdaptation(rule, team, sigma, priorEscalations, templates, fillHoles, evaluateOracle);
    if (result) {
      const remainingEvents = tag ? events.filter((e) => e !== tag) : events;
      return {
        ...result,
        adaptationCount: params.adaptationCount + 1,
        events: remainingEvents,
        applied: rule.id,
      };
    }
    events = [...events, `rejected:${rule.id}`];
  }

  return { team, sigma, escalations: priorEscalations, adaptationCount: params.adaptationCount, events };
}
