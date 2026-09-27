import { describe, expect, it, vi } from "vitest";
import type { AdaptationRule, Team, ViewMetamodel } from "@agentm2m/schema";
import { adapt } from "../src/algorithms/adapt.js";
import { defaultTemplateLibrary } from "../src/algorithms/hot.js";
import type { Sigma } from "../src/algorithms/propagate.js";

const arMM: ViewMetamodel = {
  agentRole: "AR",
  classes: [{ name: "CodeElement", concept: "code element", attributes: [], references: [] }],
  constraints: [],
};
const tsMM: ViewMetamodel = {
  agentRole: "TS",
  classes: [{ name: "TestCase", concept: "test", attributes: [], references: [] }],
  constraints: [],
};

function baseTeam(rule: AdaptationRule): Team {
  return {
    id: "t",
    name: "DevTeam",
    agents: [
      { id: "AR", role: "AR", metamodel: arMM, modelBinding: { provider: "mock", modelId: "m", temperature: 0.2, maxTokens: 1024 }, tools: [] },
      { id: "TS", role: "TS", metamodel: tsMM, modelBinding: { provider: "mock", modelId: "m", temperature: 0.2, maxTokens: 1024 }, tools: [] },
    ],
    edges: [],
    adaptationRules: [rule],
    thresholds: { theta: 2, aMax: 3 },
  };
}

function insertIaRule(): AdaptationRule {
  return {
    id: "insert-ia",
    priority: 1,
    condition: "count(regression_uncovered) >= 2",
    action: "insert_agent",
    params: {
      agent: {
        id: "IA",
        role: "ImpactAnalyst",
        metamodel: {
          agentRole: "IA",
          classes: [{ name: "Dependency", concept: "code element", attributes: [], references: [] }],
          constraints: [],
        },
        modelBinding: { provider: "mock", modelId: "ia-model", temperature: 0.2, maxTokens: 1024 },
        tools: [],
      },
      connections: [{ existingAgentId: "AR", edgeId: "e_ar_ia", omega: "->" }],
    },
  };
}

function baseSigma(): Sigma {
  return {
    AR: { model: { objects: [{ id: "ce1", className: "CodeElement", attributes: {}, references: {} }] }, version: 2 },
    TS: { model: { objects: [] }, version: 1 },
  };
}

describe("Adapt (Algorithm 5)", () => {
  it("does nothing when the rule's condition does not yet hold", async () => {
    const rule = insertIaRule();
    const team = baseTeam(rule);
    const result = await adapt({
      team,
      sigma: baseSigma(),
      events: ["regression_uncovered"],
      priorEscalations: [],
      adaptationCount: 0,
      templates: defaultTemplateLibrary(),
      fillHoles: vi.fn(),
      evaluateOracle: vi.fn().mockResolvedValue(true),
    });
    expect(result.team.agents).toHaveLength(2);
    expect(result.adaptationCount).toBe(0);
    expect(result.applied).toBeUndefined();
  });

  it("inserts the new agent, synthesizes its edge via HOT, and initializes its model — without touching retained agents", async () => {
    const rule = insertIaRule();
    const team = baseTeam(rule);
    const sigma = baseSigma();
    const evaluateOracle = vi.fn().mockResolvedValue(true);
    const fillHoles = vi.fn();

    const result = await adapt({
      team,
      sigma,
      events: ["regression_uncovered", "regression_uncovered"],
      priorEscalations: [],
      adaptationCount: 0,
      templates: defaultTemplateLibrary(),
      fillHoles,
      evaluateOracle,
    });

    expect(result.applied).toBe("insert-ia");
    expect(result.adaptationCount).toBe(1);
    expect(result.team.agents.map((a) => a.id)).toEqual(["AR", "TS", "IA"]);
    expect(result.team.edges).toHaveLength(1);
    expect(result.escalations).toHaveLength(0);

    const iaState = result.sigma.IA;
    expect(iaState.model.objects).toHaveLength(1);
    expect(iaState.model.objects[0].className).toBe("Dependency");
    expect(iaState.model.objects[0].references.callers).toEqual(["ce1"]);

    // Retained agents' models are unchanged (Proposition IV.3).
    expect(result.sigma.AR).toBe(sigma.AR);
    expect(fillHoles).not.toHaveBeenCalled(); // this template has no hole attributes

    // The consumed event is removed from K.
    expect(result.events).toEqual([]);
  });

  it("never applies once the adaptation cap A_max is reached", async () => {
    const rule = insertIaRule();
    const team = baseTeam(rule);
    const result = await adapt({
      team,
      sigma: baseSigma(),
      events: ["regression_uncovered", "regression_uncovered"],
      priorEscalations: [],
      adaptationCount: 3, // == thresholds.aMax
      templates: defaultTemplateLibrary(),
      fillHoles: vi.fn(),
      evaluateOracle: vi.fn().mockResolvedValue(true),
    });
    expect(result.applied).toBeUndefined();
    expect(result.team.agents).toHaveLength(2);
  });

  it("rolls back (leaves the team unchanged) when the synthesized edge can't be made consistent, and records a rejection", async () => {
    const rule = insertIaRule();
    const team = baseTeam(rule);
    const result = await adapt({
      team,
      sigma: baseSigma(),
      events: ["regression_uncovered", "regression_uncovered"],
      priorEscalations: [],
      adaptationCount: 0,
      templates: defaultTemplateLibrary(),
      fillHoles: vi.fn(),
      evaluateOracle: vi.fn().mockResolvedValue(false), // oracle never accepts -> GuardedRestore exhausts its budget
    });
    expect(result.applied).toBeUndefined();
    expect(result.team.agents).toHaveLength(2); // IA was never committed
    expect(result.events).toContain("rejected:insert-ia");
  });

  it("does not re-insert an agent that was already inserted by a prior adaptation", async () => {
    const rule = insertIaRule();
    const team = baseTeam(rule);
    team.agents.push({
      id: "IA",
      role: "ImpactAnalyst",
      metamodel: { agentRole: "IA", classes: [{ name: "Dependency", concept: "code element", attributes: [], references: [] }], constraints: [] },
      modelBinding: { provider: "mock", modelId: "ia-model", temperature: 0.2, maxTokens: 1024 },
      tools: [],
    });
    const result = await adapt({
      team,
      sigma: { ...baseSigma(), IA: { model: { objects: [] }, version: 0 } },
      events: ["regression_uncovered", "regression_uncovered"],
      priorEscalations: [],
      adaptationCount: 0,
      templates: defaultTemplateLibrary(),
      fillHoles: vi.fn(),
      evaluateOracle: vi.fn().mockResolvedValue(true),
    });
    expect(result.applied).toBeUndefined();
    expect(result.team.agents).toHaveLength(3); // unchanged, no duplicate insertion
  });
});
