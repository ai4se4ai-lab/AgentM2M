import { describe, expect, it } from "vitest";
import { schedule, type Obligation } from "../src/index.js";

describe("schedule (Definition III.5)", () => {
  const agentOrder = ["RA", "AR", "DV", "TS"];

  it("prioritizes escalation over failing, hole, and task", () => {
    const obligations: Obligation[] = [
      { agentId: "TS", kind: "task", payload: {} },
      { agentId: "AR", kind: "hole", payload: {} },
      { agentId: "DV", kind: "failing", payload: {} },
      { agentId: "RA", kind: "escalation", payload: {} },
    ];
    expect(schedule(obligations, agentOrder)?.kind).toBe("escalation");
  });

  it("breaks ties within the same kind by fixed agent order, never randomly", () => {
    const obligations: Obligation[] = [
      { agentId: "TS", kind: "task", payload: {} },
      { agentId: "RA", kind: "task", payload: {} },
      { agentId: "DV", kind: "task", payload: {} },
    ];
    // Run repeatedly: the fixed order must be deterministic across calls.
    for (let i = 0; i < 20; i++) {
      expect(schedule(obligations, agentOrder)?.agentId).toBe("RA");
    }
  });

  it("returns undefined for an empty worklist", () => {
    expect(schedule([], agentOrder)).toBeUndefined();
  });
});
