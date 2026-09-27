import { StructuralRuleSchema, type StructuralRule, type ViewMetamodel } from "@agentm2m/schema";

/**
 * Definition IV.1 (HOT H) — the template library Theta maps a pair of
 * concept annotations to a rule schema. This prototype's Theta is a small,
 * hand-authored map (rather than a pluggable DSL) covering the concept
 * vocabulary used by the paper's running example (code element / test /
 * requirement) — enough to synthesize the two new edges of the
 * insert-impact-analyst scenario (Table II's starred rows). Extending Theta
 * to new concept pairs means adding an entry here.
 */
export interface HotTemplate {
  /** the reference name the *covering* (target-side) class must carry, pointing back at the source object */
  viaReferenceOnTarget: string;
  /** attribute names left open for FillHoles on the created skeleton, if any */
  holeAttributes: string[];
}

export type TemplateLibrary = Map<string, HotTemplate>;

export function templateKey(conceptA: string, conceptB: string): string {
  return `${conceptA}::${conceptB}`;
}

export function defaultTemplateLibrary(): TemplateLibrary {
  const theta: TemplateLibrary = new Map();
  theta.set(templateKey("code element", "code element"), {
    viaReferenceOnTarget: "callers",
    holeAttributes: [],
  });
  theta.set(templateKey("code element", "test"), {
    viaReferenceOnTarget: "coveredBy",
    holeAttributes: [],
  });
  return theta;
}

/**
 * H(team', e): compose instances of Theta(gamma_a(c), gamma_b(c')) for every
 * class pair (c,c') across the new edge's two metamodels that carries a
 * concept annotation with a matching template.
 */
export function hot(templates: TemplateLibrary, sourceMM: ViewMetamodel, targetMM: ViewMetamodel): StructuralRule {
  const checks: StructuralRule["checks"] = [];
  for (const c of sourceMM.classes) {
    if (!c.concept) continue;
    for (const c2 of targetMM.classes) {
      if (!c2.concept) continue;
      const tmpl = templates.get(templateKey(c.concept, c2.concept));
      if (!tmpl) continue;
      checks.push({
        kind: "coverage",
        ofClass: c.name,
        ofSide: "source",
        byClass: c2.name,
        viaReference: tmpl.viaReferenceOnTarget,
        min: 1,
        skeleton: { holeAttributes: tmpl.holeAttributes },
      });
    }
  }
  return StructuralRuleSchema.parse({ checks });
}

/** Validate(beta'(e), sigma): beta'(e) type-checks against MM_a and MM_b. */
export function validateEdgeRule(rule: StructuralRule, sourceMM: ViewMetamodel, targetMM: ViewMetamodel): boolean {
  const sourceClasses = new Set(sourceMM.classes.map((c) => c.name));
  const targetClasses = new Set(targetMM.classes.map((c) => c.name));
  for (const check of rule.checks) {
    if (check.kind === "coverage") {
      const ofClasses = check.ofSide === "source" ? sourceClasses : targetClasses;
      const byClasses = check.ofSide === "source" ? targetClasses : sourceClasses;
      if (!ofClasses.has(check.ofClass) || !byClasses.has(check.byClass)) return false;
    } else {
      const ofClasses = check.ofSide === "source" ? sourceClasses : targetClasses;
      const targetSideClasses = check.ofSide === "source" ? targetClasses : sourceClasses;
      if (!ofClasses.has(check.ofClass) || !targetSideClasses.has(check.targetClass)) return false;
    }
  }
  return true;
}
