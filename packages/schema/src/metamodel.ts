import { z } from "zod";

/**
 * Definition II.1 — View metamodel: a typed graph TG_a of classes with
 * concept annotations gamma_a, plus a constraint set Phi_a.
 */
export const FieldTypeSchema = z.enum(["string", "number", "boolean", "id", "NL"]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const AttributeDefSchema = z.object({
  name: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().default(false),
});
export type AttributeDef = z.infer<typeof AttributeDefSchema>;

export const MultiplicitySchema = z.enum(["1", "0..1", "0..*", "1..*"]);
export type Multiplicity = z.infer<typeof MultiplicitySchema>;

export const ReferenceDefSchema = z.object({
  name: z.string().min(1),
  target: z.string().min(1),
  multiplicity: MultiplicitySchema,
});
export type ReferenceDef = z.infer<typeof ReferenceDefSchema>;

export const ClassDefSchema = z.object({
  name: z.string().min(1),
  concept: z.string().optional(),
  attributes: z.array(AttributeDefSchema).default([]),
  references: z.array(ReferenceDefSchema).default([]),
});
export type ClassDef = z.infer<typeof ClassDefSchema>;

/**
 * Phi_a as a small, checkable constraint subset (a JSON-Schema-derivable
 * fragment plus custom validators) rather than a full OCL engine — an
 * intentional prototype simplification documented in docs/dev.md section 1.
 */
export const ConstraintSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("minCount"),
    class: z.string(),
    reference: z.string(),
    min: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("refIntegrity"),
    class: z.string(),
    reference: z.string(),
  }),
  z.object({
    kind: z.literal("requiredNonEmpty"),
    class: z.string(),
    attribute: z.string(),
  }),
]);
export type ConstraintSpec = z.infer<typeof ConstraintSpecSchema>;

export const ViewMetamodelSchema = z.object({
  agentRole: z.string().min(1),
  classes: z.array(ClassDefSchema).min(1),
  constraints: z.array(ConstraintSpecSchema).default([]),
});
export type ViewMetamodel = z.infer<typeof ViewMetamodelSchema>;

/** A JSON-Schema subset sufficient for Ajv to validate a decoded LLM response. */
export interface JsonSchemaLike {
  $schema?: string;
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
}

/**
 * Schema(MM_a): derives the JSON Schema an agent's response is decoded
 * against, per Algorithm 2 (Lift), line 1. Ids are intentionally excluded —
 * Instantiate assigns stable ids after decoding.
 */
export function deriveJsonSchema(mm: ViewMetamodel): JsonSchemaLike {
  const classNames = mm.classes.map((c) => c.name);
  const objectSchema = {
    type: "object",
    properties: {
      className: { type: "string", enum: classNames },
      attributes: { type: "object" },
      references: { type: "object" },
    },
    required: ["className", "attributes", "references"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      objects: { type: "array", items: objectSchema },
    },
    required: ["objects"],
    additionalProperties: false,
  };
}
