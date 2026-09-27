import {
  edgesTouching,
  type AttributeValue,
  type EdgeDef,
  type Team,
  type ViewMetamodel,
  type ViewModel,
} from "@agentm2m/schema";
import { evaluateStructuralRule, type Hole, type Side } from "./structural-rule.js";
import { guardedRestore } from "./guarded-restore.js";

export interface AgentState {
  model: ViewModel;
  version: number;
}

export type Sigma = Record<string, AgentState>;

export interface Escalation {
  edgeId: string;
  diagnostics: string[];
}

export interface PropagateParams {
  team: Team;
  sigma: Sigma;
  /** C: agents whose model changed since the last call */
  changedAgents: Set<string>;
  /** X_0: escalations carried in from a previous cycle */
  priorEscalations: Escalation[];
  /** Phi of each agent's own metamodel, by agent id, for the n' in Mods(MM_t) check */
  metamodels: Record<string, ViewMetamodel>;
  fillHoles: (edge: EdgeDef, holes: Hole[], diagnostics: string[]) => Promise<Record<string, AttributeValue>>;
  evaluateOracle: (edge: EdgeDef, sourceModel: ViewModel, targetModel: ViewModel) => Promise<boolean>;
  onRestore?: (info: { edge: EdgeDef; restoreSide: Side; changed: boolean }) => void;
  /**
   * omega_init (Algorithm 5): when set, restoration may only overwrite an
   * agent whose id is in this set, regardless of what the edge's own omega
   * would otherwise permit. Adapt's scoped initialization call passes the
   * newly-inserted agents here so retained agents' models are provably
   * untouched (Proposition IV.3). Omitted for RunTeam's normal Propagate call.
   */
  restrictOverwriteTo?: Set<string>;
}

export interface PropagateResult {
  sigma: Sigma;
  escalations: Escalation[];
}

/** Direction(e,sigma,omega'): the older-stamped endpoint, or null if omega forbids overwriting it. */
export function direction(edge: EdgeDef, sigma: Sigma): Side | null {
  const vSource = sigma[edge.source]?.version ?? 0;
  const vTarget = sigma[edge.target]?.version ?? 0;
  const canOverwriteSource = edge.omega === "<-" || edge.omega === "<->";
  const canOverwriteTarget = edge.omega === "->" || edge.omega === "<->";

  if (vSource === vTarget) {
    // Ties go to the endpoint omega permits, and to the edge's target if both are permitted.
    if (canOverwriteTarget) return "target";
    if (canOverwriteSource) return "source";
    return null;
  }
  const stale: Side = vSource < vTarget ? "source" : "target";
  if (stale === "source") return canOverwriteSource ? "source" : null;
  return canOverwriteTarget ? "target" : null;
}

function isCheckedConsistent(
  edge: EdgeDef,
  sigma: Sigma,
  evaluateOracle: PropagateParams["evaluateOracle"],
): Promise<boolean> {
  const sourceModel = sigma[edge.source].model;
  const targetModel = sigma[edge.target].model;
  const structural = evaluateStructuralRule(edge.structuralRule, sourceModel, targetModel);
  if (structural.length > 0) return Promise.resolve(false);
  return evaluateOracle(edge, sourceModel, targetModel);
}

/**
 * Propagate (Algorithm 4, L0): restore consistency over the network. The
 * worklist is a priority queue over the fixed edge order (team.edges'
 * index), which is what makes runs reproducible (Remark on Stability). Each
 * edge budget l bounds work on cycles (Proposition: termination at <= l|E|
 * restorations).
 */
export async function propagate(params: PropagateParams): Promise<PropagateResult> {
  const { team, sigma, changedAgents, priorEscalations, metamodels, fillHoles, evaluateOracle, onRestore } = params;
  const fixedOrder = team.edges.map((e) => e.id);
  const edgeById = new Map(team.edges.map((e) => [e.id, e]));

  const escalatedEdgeIds = new Set(priorEscalations.map((x) => x.edgeId));
  const worklist = new Set<string>();
  for (const agentId of changedAgents) {
    for (const e of edgesTouching(team, agentId)) worklist.add(e.id);
  }
  for (const id of escalatedEdgeIds) worklist.add(id);

  const escalations: Escalation[] = [];
  const u = new Map<string, number>();

  function popMin(): EdgeDef | undefined {
    let best: string | undefined;
    let bestIdx = Infinity;
    for (const id of worklist) {
      const idx = fixedOrder.indexOf(id);
      if (idx < bestIdx) {
        bestIdx = idx;
        best = id;
      }
    }
    if (best === undefined) return undefined;
    worklist.delete(best);
    return edgeById.get(best);
  }

  while (worklist.size > 0) {
    const edge = popMin();
    if (!edge) break;

    if (await isCheckedConsistent(edge, sigma, evaluateOracle)) continue;

    let t = direction(edge, sigma);
    if (t !== null && params.restrictOverwriteTo) {
      const agentAtT = t === "source" ? edge.source : edge.target;
      if (!params.restrictOverwriteTo.has(agentAtT)) t = null;
    }
    const used = u.get(edge.id) ?? 0;
    if (t === null || used >= edge.budgets.l) {
      escalations.push({ edgeId: edge.id, diagnostics: [t === null ? "omega forbids restoring either endpoint" : `edge budget l=${edge.budgets.l} exhausted`] });
      continue;
    }

    u.set(edge.id, used + 1);
    const restoreAgentId = t === "source" ? edge.source : edge.target;
    const result = await guardedRestore({
      edge,
      sourceModel: sigma[edge.source].model,
      targetModel: sigma[edge.target].model,
      restoreSide: t,
      restoreMetamodel: metamodels[restoreAgentId],
      fillHoles: (holes, diagnostics) => fillHoles(edge, holes, diagnostics),
      evaluateOracle: (s, tt) => evaluateOracle(edge, s, tt),
    });

    if (!result.ok) {
      escalations.push({ edgeId: edge.id, diagnostics: result.diagnostics });
      continue;
    }

    onRestore?.({ edge, restoreSide: t, changed: result.changed });

    if (result.changed) {
      sigma[restoreAgentId] = { model: result.model, version: sigma[restoreAgentId].version + 1 };
      for (const other of edgesTouching(team, restoreAgentId)) {
        if (other.id !== edge.id) worklist.add(other.id);
      }
    }
  }

  return { sigma, escalations };
}
