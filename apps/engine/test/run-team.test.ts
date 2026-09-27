import { describe, expect, it } from "vitest";
import type { AttributeValue, EdgeDef, Team, ViewModel } from "@agentm2m/schema";
import { runTeam, type AgentTurnClient, type TraceEvent } from "../src/algorithms/run-team.js";
import type { Sigma } from "../src/algorithms/propagate.js";
import { holeKey } from "../src/algorithms/structural-rule.js";

const requirementResponse = JSON.stringify({
  objects: [{ className: "Requirement", attributes: { statement: "parse honors every component" }, references: {} }],
});

function makeTeam(): Team {
  const edge: EdgeDef = {
    id: "e4",
    source: "RA",
    target: "TS",
    omega: "<->",
    structuralRule: {
      checks: [
        { kind: "coverage", ofClass: "Requirement", ofSide: "source", byClass: "TestCase", viaReference: "verifies", min: 1, skeleton: { holeAttributes: ["code"] } },
      ],
    },
    oracle: { kind: "executable", executable: { command: "true" } },
    budgets: { k: 2, l: 2 },
  };
  return {
    id: "devteam",
    name: "DevTeam",
    agents: [
      { id: "RA", role: "RA", metamodel: { agentRole: "RA", classes: [{ name: "Requirement", attributes: [], references: [] }], constraints: [] }, modelBinding: { provider: "mock", modelId: "m", temperature: 0.2, maxTokens: 1024 }, tools: [] },
      { id: "TS", role: "TS", metamodel: { agentRole: "TS", classes: [{ name: "TestCase", attributes: [{ name: "code", type: "NL", required: true }], references: [{ name: "verifies", target: "Requirement", multiplicity: "1..*" }] }], constraints: [] }, modelBinding: { provider: "mock", modelId: "m", temperature: 0.2, maxTokens: 1024 }, tools: [] },
    ],
    edges: [edge],
    adaptationRules: [],
    thresholds: { theta: 2, aMax: 3 },
  };
}

function fakeClient(taskResponses: Record<string, string[]>): AgentTurnClient {
  return {
    async task(agentId) {
      const queue = taskResponses[agentId];
      if (!queue || queue.length === 0) throw new Error(`no scripted task response for ${agentId}`);
      return queue.shift()!;
    },
    async repair() {
      throw new Error("repair should not be called in this scenario");
    },
    async fillHoles(_edge, _restoreAgentId, holes) {
      const values: Record<string, AttributeValue> = {};
      for (const h of holes) values[holeKey(h)] = "assert parse('1h30m').seconds == 5400";
      return values;
    },
  };
}

const alwaysTrueOracle = async () => true;

describe("RunTeam (Algorithm 1)", () => {
  it("reaches phi via a single agent turn plus automatic propagation, and stops before spending the whole budget", async () => {
    const team = makeTeam();
    const events: TraceEvent[] = [];
    const result = await runTeam({
      task: "fix Duration.parse",
      team,
      phi: (sigma: Sigma) => sigma.TS.model.objects.some((o) => o.className === "TestCase"),
      budget: 10,
      client: fakeClient({ RA: [requirementResponse] }),
      evaluateOracle: alwaysTrueOracle,
      onEvent: (e) => events.push(e),
    });

    expect(result.accepted).toBe(true);
    expect(result.cost).toBe(1); // exactly one agent turn was needed
    expect(result.sigma.TS.model.objects).toHaveLength(1);
    expect(result.escalations).toHaveLength(0);
    expect(events.some((e) => e.algorithm === "Propagate" && e.step === "restore")).toBe(true);
  });

  it("stops at the budget when phi never holds, and still returns a best-effort artifact", async () => {
    const team = makeTeam();
    // TS never legitimately produces content on its own turn; only propagation
    // creates it, and phi here requires two independent TestCase entries so it
    // is deliberately unreachable within a tiny budget.
    const result = await runTeam({
      task: "fix Duration.parse",
      team,
      phi: (sigma: Sigma) => sigma.TS.model.objects.length >= 2,
      budget: 1,
      client: fakeClient({ RA: [requirementResponse] }),
      evaluateOracle: alwaysTrueOracle,
    });

    expect(result.accepted).toBe(false);
    expect(result.cost).toBe(1);
    expect(result.artifact).toBeTruthy();
  });

  it("records a liftFail event and still terminates at the budget when an agent's response never converges", async () => {
    const team = makeTeam();
    const events: TraceEvent[] = [];
    const client: AgentTurnClient = {
      async task() {
        return "not valid json";
      },
      async repair() {
        return "still not valid json";
      },
      async fillHoles() {
        return {};
      },
    };

    const result = await runTeam({
      task: "fix Duration.parse",
      team,
      phi: () => false,
      budget: 2,
      client,
      evaluateOracle: alwaysTrueOracle,
      maxLiftRetries: 3,
      onEvent: (e) => events.push(e),
    });

    expect(result.accepted).toBe(false);
    expect(result.iterations).toBe(1); // one task call + 3 repairs already exceeds the budget of 2
    expect(result.cost).toBe(4);
    expect(events).toContainEqual(expect.objectContaining({ algorithm: "Lift", step: "fail", agentId: "RA" }));
  });
});
