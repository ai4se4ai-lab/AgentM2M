import { z } from "zod";

/** One line-numbered step of an algorithm, emitted for the trace viewer (dashboard §6.2 RunTraceTimeline). */
export const RunEventSchema = z.object({
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  algorithm: z.enum(["RunTeam", "Lift", "GuardedRestore", "Propagate", "Adapt"]),
  step: z.string(),
  agentId: z.string().optional(),
  edgeId: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunStatusSchema = z.enum(["running", "succeeded", "failed", "budget_exhausted"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;
