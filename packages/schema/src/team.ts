import { z } from "zod";
import { ViewMetamodelSchema } from "./metamodel.js";

/** G2: any agent role binds to a cloud provider model or a local Ollama model. */
export const ModelProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "ollama",
  "mock",
]);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ModelBindingSchema = z.object({
  provider: ModelProviderSchema,
  modelId: z.string().min(1),
  ollamaHost: z.string().url().optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().default(2048),
});
export type ModelBinding = z.infer<typeof ModelBindingSchema>;

export const AgentDefSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  metamodel: ViewMetamodelSchema,
  modelBinding: ModelBindingSchema,
  tools: z.array(z.string()).default([]),
  systemPrompt: z.string().optional(),
});
export type AgentDef = z.infer<typeof AgentDefSchema>;

/** omega(e): propagation rights per Definition III.2. */
export const OmegaSchema = z.enum(["->", "<-", "<->"]);
export type Omega = z.infer<typeof OmegaSchema>;

/**
 * R_e^str as a small declarative rule set — the MVP simplification of
 * TGG-style rules noted in docs/dev.md §7 ("for-each unmatched X, create
 * skeleton Y with holes" rather than a full triple-graph-grammar engine).
 *
 * A `coverage` check says: every object of `ofClass` (living on `ofSide` of
 * the edge) must be referenced by >=`min` objects of `byClass` (the other
 * side) via `byClass`'s own `viaReference`. When violated and `skeleton` is
 * set, Rule_e may create a `byClass` skeleton on the side being restored,
 * with `holeAttributes` left open for FillHoles.
 *
 * A `refIntegrity` check says: every `reference` on `ofClass` objects must
 * point to objects that exist as `targetClass` on the other side. Violations
 * are diagnosed but not auto-repaired by Rule_e (documented simplification —
 * dangling cross-model references are escalated rather than silently
 * dropped, matching P1's "no side channel" principle).
 */
export const CoverageCheckSchema = z.object({
  kind: z.literal("coverage"),
  ofClass: z.string().min(1),
  ofSide: z.enum(["source", "target"]),
  byClass: z.string().min(1),
  viaReference: z.string().min(1),
  min: z.number().int().nonnegative().default(1),
  skeleton: z.object({ holeAttributes: z.array(z.string()).default([]) }).optional(),
});
export type CoverageCheck = z.infer<typeof CoverageCheckSchema>;

export const RefIntegrityCheckSchema = z.object({
  kind: z.literal("refIntegrity"),
  ofClass: z.string().min(1),
  ofSide: z.enum(["source", "target"]),
  reference: z.string().min(1),
  targetClass: z.string().min(1),
});
export type RefIntegrityCheck = z.infer<typeof RefIntegrityCheckSchema>;

export const StructuralCheckSchema = z.discriminatedUnion("kind", [
  CoverageCheckSchema,
  RefIntegrityCheckSchema,
]);
export type StructuralCheck = z.infer<typeof StructuralCheckSchema>;

export const StructuralRuleSchema = z.object({
  checks: z.array(StructuralCheckSchema).default([]),
});
export type StructuralRule = z.infer<typeof StructuralRuleSchema>;

export const OracleSpecSchema = z.object({
  kind: z.enum(["executable", "llm_judge", "hybrid"]),
  executable: z.object({ command: z.string() }).optional(),
  llmJudge: z
    .object({ promptTemplate: z.string(), modelBinding: ModelBindingSchema.optional() })
    .optional(),
});
export type OracleSpec = z.infer<typeof OracleSpecSchema>;

export const EdgeDefSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  omega: OmegaSchema,
  structuralRule: StructuralRuleSchema,
  oracle: OracleSpecSchema,
  budgets: z.object({ k: z.number().int().positive().default(2), l: z.number().int().positive().default(2) }),
});
export type EdgeDef = z.infer<typeof EdgeDefSchema>;

export const AdaptationActionSchema = z.enum([
  "insert_agent",
  "split_role",
  "switch_backend",
  "custom",
]);
export type AdaptationAction = z.infer<typeof AdaptationActionSchema>;

export const AdaptationRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int(),
  condition: z.string().min(1),
  action: AdaptationActionSchema,
  params: z.record(z.string(), z.unknown()).default({}),
});
export type AdaptationRule = z.infer<typeof AdaptationRuleSchema>;

export const TeamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  agents: z.array(AgentDefSchema).min(1),
  edges: z.array(EdgeDefSchema).default([]),
  adaptationRules: z.array(AdaptationRuleSchema).default([]),
  thresholds: z.object({
    theta: z.number().int().positive().default(2),
    aMax: z.number().int().nonnegative().default(3),
  }),
});
export type Team = z.infer<typeof TeamSchema>;

export function edgesTouching(team: Team, agentId: string): EdgeDef[] {
  return team.edges.filter((e) => e.source === agentId || e.target === agentId);
}

export function otherEndpoint(edge: EdgeDef, agentId: string): string {
  return edge.source === agentId ? edge.target : edge.source;
}
