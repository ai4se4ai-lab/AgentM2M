import { schedule, type AttributeValue, type EdgeDef, type Obligation, type Team, type ViewModel } from "@agentm2m/schema";
import { lift } from "./lift.js";
import { propagate, type Escalation, type Sigma } from "./propagate.js";
import { adapt } from "./adapt.js";
import { defaultTemplateLibrary, type TemplateLibrary } from "./hot.js";
import type { Hole } from "./structural-rule.js";

export interface AgentTurnClient {
  /** pi_a(M_a, o): a full LLM turn for obligation `o`, returning raw (expected-JSON) text */
  task(agentId: string, obligationPayload: unknown, model: ViewModel): Promise<string>;
  /** pi_a.Repair(r, Explain(V)): re-prompt the same agent with structured validation errors */
  repair(agentId: string, previousResponse: string, explanation: string): Promise<string>;
  /** FillHoles: an LLM call scoped to only the open hole fields of one restored object */
  fillHoles(edge: EdgeDef, restoreAgentId: string, holes: Hole[], diagnostics: string[]): Promise<Record<string, AttributeValue>>;
}

export interface RunTeamParams {
  task: string;
  team: Team;
  /** phi(sigma): acceptance predicate over the current runtime models */
  phi: (sigma: Sigma) => boolean;
  /** B: budget, measured in agent turns (a documented simplification of full token/cost billing — see RQ6 usage tracking in the model router) */
  budget: number;
  client: AgentTurnClient;
  evaluateOracle: (edge: EdgeDef, sourceModel: ViewModel, targetModel: ViewModel) => Promise<boolean>;
  templates?: TemplateLibrary;
  /** M2T(sigma): model-to-text. Defaults to collecting every object's `diff` attribute, else a JSON dump. */
  m2t?: (sigma: Sigma, team: Team) => string;
  maxLiftRetries?: number;
  onEvent?: (event: TraceEvent) => void;
}

export interface TraceEvent {
  algorithm: "RunTeam" | "Lift" | "Propagate" | "Adapt";
  step: string;
  agentId?: string;
  edgeId?: string;
  detail?: Record<string, unknown>;
}

export interface RunTeamResult {
  artifact: string;
  accepted: boolean;
  sigma: Sigma;
  team: Team;
  cost: number;
  iterations: number;
  escalations: Escalation[];
}

function defaultM2T(sigma: Sigma): string {
  const diffs: string[] = [];
  for (const state of Object.values(sigma)) {
    for (const obj of state.model.objects) {
      const diff = obj.attributes.diff;
      if (typeof diff === "string" && diff.length > 0) diffs.push(diff);
    }
  }
  if (diffs.length > 0) return diffs.join("\n");
  return JSON.stringify(sigma, null, 2);
}

/** Escalate to the endpoint whose model is *newer* — the one whose recent change caused the illegitimate propagation. */
function escalationAuthor(edge: EdgeDef, sigma: Sigma): string {
  const vSource = sigma[edge.source]?.version ?? 0;
  const vTarget = sigma[edge.target]?.version ?? 0;
  return vSource >= vTarget ? edge.source : edge.target;
}

/**
 * RunTeam (Algorithm 1, L1): drives the MAPE-K loop. An agent's response
 * enters the team only through Lift and Propagate (P1); the run ends when
 * phi holds or the budget is spent, and a best-effort artifact is always
 * produced via M2T (line ret).
 *
 * Obligation derivation (Schedule's input) is simplified relative to the
 * paper: this prototype drives normal 'task' turns through the team's fixed
 * agent order in a round-robin (documented in docs/dev.md §7) rather than a
 * full task-decomposition engine, while 'escalation' obligations (from
 * Propagate/Adapt) always preempt the rotation, matching the priority order
 * of Definition III.5.
 */
export async function runTeam(params: RunTeamParams): Promise<RunTeamResult> {
  const { team: initialTeam, phi, budget, client, evaluateOracle, onEvent } = params;
  const templates = params.templates ?? defaultTemplateLibrary();
  const maxLiftRetries = params.maxLiftRetries ?? 3;
  const m2t = params.m2t ?? defaultM2T;

  let team = initialTeam;
  let sigma: Sigma = Object.fromEntries(team.agents.map((a) => [a.id, { model: { objects: [] }, version: 0 }]));
  let events: string[] = [];
  let escalations: Escalation[] = [];
  let cost = 0;
  let iterations = 0;
  let adaptationCount = 0;
  let rotationIndex = -1;

  const fillHoles = async (edge: EdgeDef, holes: Hole[], diagnostics: string[]) => {
    // The restored side is whichever endpoint's model these holes belong to;
    // both endpoints share the same agent-model-binding lookup by class ownership.
    const restoreAgentId = team.agents.find((a) => a.metamodel.classes.some((c) => c.name === holes[0]?.className))?.id
      ?? edge.target;
    return client.fillHoles(edge, restoreAgentId, holes, diagnostics);
  };

  const emit = (evt: TraceEvent) => onEvent?.(evt);

  emit({ algorithm: "RunTeam", step: "init", detail: { task: params.task, agents: team.agents.map((a) => a.id) } });

  while (!phi(sigma) && cost < budget) {
    iterations += 1;

    let obligation: Obligation;
    if (escalations.length > 0) {
      const esc = escalations[0];
      const edge = team.edges.find((e) => e.id === esc.edgeId);
      obligation = { agentId: edge ? escalationAuthor(edge, sigma) : team.agents[0].id, kind: "escalation", payload: esc };
    } else {
      rotationIndex = (rotationIndex + 1) % team.agents.length;
      obligation = { agentId: team.agents[rotationIndex].id, kind: "task", payload: { task: params.task } };
    }

    const scheduled = schedule([obligation], team.agents.map((a) => a.id))!;
    const agent = team.agents.find((a) => a.id === scheduled.agentId)!;

    emit({ algorithm: "RunTeam", step: "schedule", agentId: agent.id, detail: { kind: scheduled.kind } });

    const response = await client.task(agent.id, scheduled.payload, sigma[agent.id].model);
    cost += 1;

    const liftResult = await lift({
      response,
      metamodel: agent.metamodel,
      current: sigma[agent.id].model,
      maxRetries: maxLiftRetries,
      repair: (prev, explanation) => {
        cost += 1;
        return client.repair(agent.id, prev, explanation);
      },
    });

    if (!liftResult) {
      events.push(`liftFail:${agent.id}`);
      emit({ algorithm: "Lift", step: "fail", agentId: agent.id });
    } else {
      sigma[agent.id] = { model: liftResult.model, version: sigma[agent.id].version + 1 };
      emit({ algorithm: "Lift", step: "ok", agentId: agent.id, detail: { diff: liftResult.diff } });

      const propResult = await propagate({
        team,
        sigma,
        changedAgents: new Set([agent.id]),
        priorEscalations: escalations,
        metamodels: Object.fromEntries(team.agents.map((a) => [a.id, a.metamodel])),
        fillHoles,
        evaluateOracle,
        onRestore: (info) => emit({ algorithm: "Propagate", step: "restore", edgeId: info.edge.id, detail: { restoreSide: info.restoreSide, changed: info.changed } }),
      });
      sigma = propResult.sigma;
      escalations = propResult.escalations;
      for (const esc of escalations) events.push(`escalation:${esc.edgeId}`);
    }

    const adaptResult = await adapt({
      team,
      sigma,
      events,
      priorEscalations: escalations,
      adaptationCount,
      templates,
      fillHoles,
      evaluateOracle,
    });
    if (adaptResult.applied) {
      emit({ algorithm: "Adapt", step: "applied", detail: { rule: adaptResult.applied } });
    }
    team = adaptResult.team;
    sigma = adaptResult.sigma;
    escalations = adaptResult.escalations;
    adaptationCount = adaptResult.adaptationCount;
    events = adaptResult.events;
  }

  const accepted = phi(sigma);
  emit({ algorithm: "RunTeam", step: "done", detail: { accepted, iterations, cost } });

  return { artifact: m2t(sigma, team), accepted, sigma, team, cost, iterations, escalations };
}
