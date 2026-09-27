import { z } from "zod";

/**
 * Definition III.5 — an obligation is a unit of work owed by an agent.
 * Priority order (highest first): escalation > failing > hole > task.
 */
export const ObligationKindSchema = z.enum(["escalation", "failing", "hole", "task"]);
export type ObligationKind = z.infer<typeof ObligationKindSchema>;

export const ObligationSchema = z.object({
  agentId: z.string().min(1),
  kind: ObligationKindSchema,
  payload: z.unknown(),
});
export type Obligation = z.infer<typeof ObligationSchema>;

const KIND_RANK: Record<ObligationKind, number> = {
  escalation: 0,
  failing: 1,
  hole: 2,
  task: 3,
};

/**
 * Schedule(Obl): pick the highest-priority obligation, ties broken by a
 * fixed agent order (a stable sort key, never Math.random — docs/dev.md §7).
 */
export function schedule(obligations: Obligation[], agentOrder: string[]): Obligation | undefined {
  if (obligations.length === 0) return undefined;
  const rankOf = (o: Obligation) => agentOrder.indexOf(o.agentId);
  return [...obligations].sort((a, b) => {
    const kindDiff = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (kindDiff !== 0) return kindDiff;
    return rankOf(a) - rankOf(b);
  })[0];
}
