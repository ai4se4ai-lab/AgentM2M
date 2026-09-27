import { checkConstraints, type AttributeValue, type EdgeDef, type ViewMetamodel, type ViewModel } from "@agentm2m/schema";
import { applyRuleRestore, evaluateStructuralRule, fillHoleValues, type Hole, type Side } from "./structural-rule.js";

export interface GuardedRestoreParams {
  edge: EdgeDef;
  /** model of edge.source, in canonical edge order (not restore direction) */
  sourceModel: ViewModel;
  /** model of edge.target, in canonical edge order */
  targetModel: ViewModel;
  /** which endpoint this call is allowed to overwrite */
  restoreSide: Side;
  /** Phi of the metamodel on `restoreSide`, for the n' in Mods(MM_t) conformance check */
  restoreMetamodel: ViewMetamodel;
  /** LLM call scoped to only the hole fields; identity if there are no holes */
  fillHoles: (holes: Hole[], diagnostics: string[]) => Promise<Record<string, AttributeValue>>;
  /** O_e(m,n) */
  evaluateOracle: (sourceModel: ViewModel, targetModel: ViewModel) => Promise<boolean>;
}

export type GuardedRestoreResult =
  | { ok: true; model: ViewModel; changed: boolean }
  | { ok: false; diagnostics: string[] };

/**
 * GuardedRestore (Algorithm 3, L0): restore one edge in one direction. A
 * deterministic rule first repairs the structure and opens holes; an LLM
 * fills only the holes; a candidate is accepted only if it conforms,
 * satisfies R_e^str, and passes O_e. Line 1's hippocratic short-circuit
 * avoids any LLM/oracle spend when the edge is already consistent.
 */
export async function guardedRestore(params: GuardedRestoreParams): Promise<GuardedRestoreResult> {
  const { edge, sourceModel, targetModel, restoreSide, restoreMetamodel, fillHoles, evaluateOracle } = params;

  const initialViolations = evaluateStructuralRule(edge.structuralRule, sourceModel, targetModel);
  if (initialViolations.length === 0 && (await evaluateOracle(sourceModel, targetModel))) {
    return { ok: true, model: restoreSide === "source" ? sourceModel : targetModel, changed: false };
  }

  const { model: n0, holes } = applyRuleRestore(edge.structuralRule, sourceModel, targetModel, restoreSide);
  let diagnostics: string[] = [];

  for (let attempt = 1; attempt <= edge.budgets.k; attempt++) {
    const values = holes.length > 0 ? await fillHoles(holes, diagnostics) : {};
    const filled = fillHoleValues(n0, holes, values);

    const candidateSource = restoreSide === "source" ? filled : sourceModel;
    const candidateTarget = restoreSide === "target" ? filled : targetModel;

    const conformanceViolations = checkConstraints(filled, restoreMetamodel);
    const structuralViolations = evaluateStructuralRule(edge.structuralRule, candidateSource, candidateTarget);

    if (conformanceViolations.length === 0 && structuralViolations.length === 0) {
      if (await evaluateOracle(candidateSource, candidateTarget)) {
        return { ok: true, model: filled, changed: true };
      }
      diagnostics = ["oracle rejected candidate"];
      continue;
    }

    diagnostics = [
      ...conformanceViolations.map((v) => v.message),
      ...structuralViolations.map((v) => v.message),
    ];
  }
  return { ok: false, diagnostics };
}
