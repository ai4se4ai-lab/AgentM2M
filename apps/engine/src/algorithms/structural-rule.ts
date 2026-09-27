import type {
  AttributeValue,
  CoverageCheck,
  ModelObject,
  RefIntegrityCheck,
  StructuralCheck,
  StructuralRule,
  ViewModel,
} from "@agentm2m/schema";

export interface StructuralViolation {
  check: StructuralCheck;
  message: string;
}

export interface Hole {
  objectId: string;
  attribute: string;
  className: string;
  /** the ground-truth object that triggered this skeleton, for prompt context */
  context: Record<string, unknown>;
}

export type Side = "source" | "target";

function sideModel(side: Side, sourceModel: ViewModel, targetModel: ViewModel): ViewModel {
  return side === "source" ? sourceModel : targetModel;
}

function otherSide(side: Side): Side {
  return side === "source" ? "target" : "source";
}

export function evaluateStructuralRule(
  rule: StructuralRule,
  sourceModel: ViewModel,
  targetModel: ViewModel,
): StructuralViolation[] {
  const violations: StructuralViolation[] = [];
  for (const check of rule.checks) {
    if (check.kind === "coverage") violations.push(...evaluateCoverage(check, sourceModel, targetModel));
    else violations.push(...evaluateRefIntegrity(check, sourceModel, targetModel));
  }
  return violations;
}

function evaluateCoverage(
  check: CoverageCheck,
  sourceModel: ViewModel,
  targetModel: ViewModel,
): StructuralViolation[] {
  const ofModel = sideModel(check.ofSide, sourceModel, targetModel);
  const byModel = sideModel(otherSide(check.ofSide), sourceModel, targetModel);
  const ofObjects = ofModel.objects.filter((o) => o.className === check.ofClass);
  const byObjects = byModel.objects.filter((o) => o.className === check.byClass);

  const violations: StructuralViolation[] = [];
  for (const ofObj of ofObjects) {
    const count = byObjects.filter((b) => (b.references[check.viaReference] ?? []).includes(ofObj.id)).length;
    if (count < check.min) {
      violations.push({
        check,
        message: `${check.ofClass}#${ofObj.id} covered by ${count} < ${check.min} ${check.byClass} via '${check.viaReference}'`,
      });
    }
  }
  return violations;
}

function evaluateRefIntegrity(
  check: RefIntegrityCheck,
  sourceModel: ViewModel,
  targetModel: ViewModel,
): StructuralViolation[] {
  const ofModel = sideModel(check.ofSide, sourceModel, targetModel);
  const targetSideModel = sideModel(otherSide(check.ofSide), sourceModel, targetModel);
  const targetIds = new Set(
    targetSideModel.objects.filter((o) => o.className === check.targetClass).map((o) => o.id),
  );
  const ofObjects = ofModel.objects.filter((o) => o.className === check.ofClass);

  const violations: StructuralViolation[] = [];
  for (const ofObj of ofObjects) {
    for (const targetId of ofObj.references[check.reference] ?? []) {
      if (!targetIds.has(targetId)) {
        violations.push({
          check,
          message: `${check.ofClass}#${ofObj.id}.${check.reference} -> missing ${check.targetClass}#${targetId}`,
        });
      }
    }
  }
  return violations;
}

/**
 * Rule_e(m,n): the deterministic half of GuardedRestore (Algorithm 3, line
 * 2). For every coverage check whose covering side (`byClass`) equals
 * `restoreSide` and that declares a skeleton, create one skeleton object per
 * uncovered `ofClass` object, pre-wired via `viaReference`, with
 * `holeAttributes` left open. Checks belonging to the other side are left
 * untouched — they are not this restore call's to fix (documented MVP
 * simplification of a full TGG engine, docs/dev.md §7).
 */
export function applyRuleRestore(
  rule: StructuralRule,
  sourceModel: ViewModel,
  targetModel: ViewModel,
  restoreSide: Side,
): { model: ViewModel; holes: Hole[] } {
  const restoreModel = sideModel(restoreSide, sourceModel, targetModel);
  const holes: Hole[] = [];
  const newObjects: ModelObject[] = [...restoreModel.objects];

  for (const check of rule.checks) {
    if (check.kind !== "coverage" || !check.skeleton) continue;
    const byClassSide = otherSide(check.ofSide);
    if (byClassSide !== restoreSide) continue;

    const ofModel = sideModel(check.ofSide, sourceModel, targetModel);
    const ofObjects = ofModel.objects.filter((o) => o.className === check.ofClass);

    for (const ofObj of ofObjects) {
      const count = newObjects.filter(
        (b) => b.className === check.byClass && (b.references[check.viaReference] ?? []).includes(ofObj.id),
      ).length;
      if (count >= check.min) continue;

      const holeAttrs: Record<string, AttributeValue> = {};
      for (const attr of check.skeleton.holeAttributes) holeAttrs[attr] = null;

      const skeleton: ModelObject = {
        id: `${check.byClass.toLowerCase()}-skeleton-${ofObj.id}`,
        className: check.byClass,
        attributes: holeAttrs,
        references: { [check.viaReference]: [ofObj.id] },
      };
      newObjects.push(skeleton);
      for (const attr of check.skeleton.holeAttributes) {
        holes.push({
          objectId: skeleton.id,
          attribute: attr,
          className: check.byClass,
          context: { triggeredBy: { className: ofObj.className, id: ofObj.id, attributes: ofObj.attributes } },
        });
      }
    }
  }

  return { model: { objects: newObjects }, holes };
}

export function holeKey(hole: Hole): string {
  return `${hole.objectId}.${hole.attribute}`;
}

/** FillHoles: apply LLM-provided values for open hole attributes; identity if there are no holes. */
export function fillHoleValues(
  model: ViewModel,
  holes: Hole[],
  values: Record<string, AttributeValue>,
): ViewModel {
  if (holes.length === 0) return model;
  const objects = model.objects.map((obj) => {
    const relevant = holes.filter((h) => h.objectId === obj.id);
    if (relevant.length === 0) return obj;
    const attributes = { ...obj.attributes };
    for (const hole of relevant) {
      const key = holeKey(hole);
      if (key in values) attributes[hole.attribute] = values[key];
    }
    return { ...obj, attributes };
  });
  return { objects };
}
