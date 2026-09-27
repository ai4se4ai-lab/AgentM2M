import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConstraintSpec, ViewMetamodel } from "./metamodel.js";

export const AttributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type AttributeValue = z.infer<typeof AttributeValueSchema>;

export const ModelObjectSchema = z.object({
  id: z.string(),
  className: z.string(),
  attributes: z.record(z.string(), AttributeValueSchema),
  references: z.record(z.string(), z.array(z.string())),
});
export type ModelObject = z.infer<typeof ModelObjectSchema>;

export const ViewModelSchema = z.object({
  objects: z.array(ModelObjectSchema),
});
export type ViewModel = z.infer<typeof ViewModelSchema>;

/** Decoded shape before Instantiate assigns stable ids — no `id` field yet. */
export const DecodedObjectSchema = z.object({
  className: z.string(),
  attributes: z.record(z.string(), AttributeValueSchema),
  references: z.record(z.string(), z.array(z.string())),
});
export type DecodedObject = z.infer<typeof DecodedObjectSchema>;

export const DecodedResponseSchema = z.object({
  objects: z.array(DecodedObjectSchema),
});
export type DecodedResponse = z.infer<typeof DecodedResponseSchema>;

export function emptyModel(): ViewModel {
  return { objects: [] };
}

/**
 * A content-hash-based structural signature used by Instantiate to reuse an
 * object's id when a decoded object matches a previous element — the
 * prototype's simplification of full model matching (docs/dev.md section 7).
 */
export function structuralSignature(obj: DecodedObject): string {
  const h = createHash("sha256");
  h.update(obj.className);
  h.update(JSON.stringify(sortedEntries(obj.attributes)));
  return h.digest("hex");
}

function sortedEntries(o: Record<string, unknown>): [string, unknown][] {
  return Object.keys(o)
    .sort()
    .map((k) => [k, o[k]]);
}

/**
 * Instantiate(Decode(r,S), TG_a, M): assign stable ids to decoded objects by
 * reusing the id of a previous object with the same structural signature,
 * otherwise minting a fresh one. References are re-pointed to the resulting
 * ids by position when the target index still exists.
 */
export function instantiate(decoded: DecodedResponse, previous: ViewModel): ViewModel {
  const bySignature = new Map<string, ModelObject[]>();
  for (const obj of previous.objects) {
    const sig = structuralSignature({
      className: obj.className,
      attributes: obj.attributes,
      references: obj.references,
    });
    const bucket = bySignature.get(sig) ?? [];
    bucket.push(obj);
    bySignature.set(sig, bucket);
  }

  const usedPreviousIds = new Set<string>();
  const idByIndex: string[] = [];
  let freshCounter = 0;

  for (const obj of decoded.objects) {
    const sig = structuralSignature(obj);
    const bucket = bySignature.get(sig) ?? [];
    const reusable = bucket.find((b) => !usedPreviousIds.has(b.id));
    if (reusable) {
      usedPreviousIds.add(reusable.id);
      idByIndex.push(reusable.id);
    } else {
      idByIndex.push(`${obj.className.toLowerCase()}-${freshCounter++}-${shortHash(sig)}`);
    }
  }

  const objects: ModelObject[] = decoded.objects.map((obj, i) => ({
    id: idByIndex[i],
    className: obj.className,
    attributes: obj.attributes,
    references: remapReferences(obj.references, idByIndex),
  }));

  return { objects };
}

function remapReferences(
  references: Record<string, string[]>,
  idByIndex: string[],
): Record<string, string[]> {
  const remapped: Record<string, string[]> = {};
  for (const [refName, targets] of Object.entries(references)) {
    remapped[refName] = targets.map((t) => {
      const idx = Number(t);
      if (Number.isInteger(idx) && idx >= 0 && idx < idByIndex.length) return idByIndex[idx];
      return t; // already an id (e.g. referencing an object outside this response)
    });
  }
  return remapped;
}

function shortHash(sig: string): string {
  return sig.slice(0, 8);
}

export interface ModelDiff {
  added: ModelObject[];
  removed: ModelObject[];
  changed: { id: string; before: ModelObject; after: ModelObject }[];
}

export function diffModels(before: ViewModel, after: ViewModel): ModelDiff {
  const beforeById = new Map(before.objects.map((o) => [o.id, o]));
  const afterById = new Map(after.objects.map((o) => [o.id, o]));
  const added: ModelObject[] = [];
  const removed: ModelObject[] = [];
  const changed: ModelDiff["changed"] = [];

  for (const [id, a] of afterById) {
    const b = beforeById.get(id);
    if (!b) added.push(a);
    else if (JSON.stringify(b) !== JSON.stringify(a)) changed.push({ id, before: b, after: a });
  }
  for (const [id, b] of beforeById) {
    if (!afterById.has(id)) removed.push(b);
  }
  return { added, removed, changed };
}

export interface ConstraintViolation {
  constraint: ConstraintSpec;
  message: string;
}

/** TypeErrors(M') ∪ {phi in Phi_a | M' does not model phi} — Algorithm 2, line 4. */
export function checkConstraints(model: ViewModel, mm: ViewMetamodel): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const knownClasses = new Set(mm.classes.map((c) => c.name));

  for (const obj of model.objects) {
    if (!knownClasses.has(obj.className)) {
      violations.push({
        constraint: { kind: "refIntegrity", class: obj.className, reference: "*" },
        message: `unknown class '${obj.className}'`,
      });
    }
  }

  for (const constraint of mm.constraints) {
    if (constraint.kind === "minCount") {
      const sources = model.objects.filter((o) => o.className === constraint.class);
      for (const s of sources) {
        const count = (s.references[constraint.reference] ?? []).length;
        if (count < constraint.min) {
          violations.push({
            constraint,
            message: `${constraint.class}#${s.id}.${constraint.reference} has ${count} < ${constraint.min}`,
          });
        }
      }
    } else if (constraint.kind === "refIntegrity") {
      const ids = new Set(model.objects.map((o) => o.id));
      const sources = model.objects.filter((o) => o.className === constraint.class);
      for (const s of sources) {
        for (const target of s.references[constraint.reference] ?? []) {
          if (!ids.has(target)) {
            violations.push({
              constraint,
              message: `${constraint.class}#${s.id}.${constraint.reference} -> missing '${target}'`,
            });
          }
        }
      }
    } else if (constraint.kind === "requiredNonEmpty") {
      const sources = model.objects.filter((o) => o.className === constraint.class);
      for (const s of sources) {
        const value = s.attributes[constraint.attribute];
        if (value === undefined || value === null || value === "") {
          violations.push({
            constraint,
            message: `${constraint.class}#${s.id}.${constraint.attribute} is empty`,
          });
        }
      }
    }
  }
  return violations;
}

/** Explain(V): a human/LLM-readable rendering of validation errors for repair prompts. */
export function explainViolations(violations: ConstraintViolation[]): string {
  if (violations.length === 0) return "no violations";
  return violations.map((v) => `- ${v.message}`).join("\n");
}
