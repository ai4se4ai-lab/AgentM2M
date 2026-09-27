import type { Team } from "@agentm2m/schema";

const ollama = (modelId = "qwen2.5:3b") =>
  ({ provider: "ollama" as const, modelId, temperature: 0.2, maxTokens: 1024 }) satisfies Team["agents"][number]["modelBinding"];

/**
 * The paper's running example team (Table II / §III's DevTeam: RA, AR, DV,
 * TS), used as the dashboard's seed data. Only the RA<->TS edge (e4) is
 * exercised end-to-end against a real model in this prototype's integration
 * test; e1-e3 are included here for a faithful, browsable team model in the
 * Team Builder, and are runnable through the same engine — just not yet
 * covered by an automated real-model test (documented scope limit).
 */
export const devTeam: Team = {
  id: "devteam",
  name: "DevTeam (RA / AR / DV / TS)",
  agents: [
    {
      id: "RA",
      role: "RA",
      metamodel: {
        agentRole: "RA",
        classes: [
          {
            name: "Requirement",
            concept: "requirement",
            attributes: [{ name: "statement", type: "NL", required: true }],
            references: [],
          },
          {
            name: "ReproScenario",
            concept: "requirement",
            attributes: [
              { name: "input", type: "string", required: true },
              { name: "expected", type: "number", required: true },
              { name: "observed", type: "number", required: false },
            ],
            references: [{ name: "of", target: "Requirement", multiplicity: "1" }],
          },
        ],
        constraints: [{ kind: "requiredNonEmpty", class: "Requirement", attribute: "statement" }],
      },
      modelBinding: ollama(),
      tools: [],
      systemPrompt: "You are the Requirements Analyst (RA). Read the issue and file precise requirements and repro scenarios.",
    },
    {
      id: "AR",
      role: "AR",
      metamodel: {
        agentRole: "AR",
        classes: [
          { name: "CodeElement", concept: "code element", attributes: [{ name: "path", type: "string", required: true }, { name: "symbol", type: "string", required: true }], references: [] },
          {
            name: "ChangePoint",
            concept: "code element",
            attributes: [{ name: "target", type: "string", required: true }, { name: "rationale", type: "NL", required: true }],
            references: [{ name: "realizes", target: "Requirement", multiplicity: "1..*" }],
          },
        ],
        constraints: [],
      },
      modelBinding: ollama(),
      tools: [],
      systemPrompt: "You are the Architect (AR). Localize requirements to code elements and open change points.",
    },
    {
      id: "DV",
      role: "DV",
      metamodel: {
        agentRole: "DV",
        classes: [
          {
            name: "Hunk",
            concept: "code element",
            attributes: [{ name: "path", type: "string", required: true }, { name: "diff", type: "NL", required: true }],
            references: [{ name: "realizesChangePoint", target: "ChangePoint", multiplicity: "1..*" }],
          },
        ],
        constraints: [],
      },
      modelBinding: ollama(),
      tools: [],
      systemPrompt: "You are the Developer (DV). Implement change points as patch hunks.",
    },
    {
      id: "TS",
      role: "TS",
      metamodel: {
        agentRole: "TS",
        classes: [
          {
            name: "TestCase",
            concept: "test",
            attributes: [{ name: "code", type: "NL", required: true }, { name: "verdict", type: "string", required: false }],
            references: [{ name: "verifies", target: "Requirement", multiplicity: "1..*" }],
          },
          { name: "Finding", concept: "test", attributes: [{ name: "note", type: "NL", required: true }], references: [] },
        ],
        constraints: [],
      },
      modelBinding: ollama(),
      tools: [],
      systemPrompt: "You are the Test Specialist (TS). Author repro/regression tests and record findings.",
    },
  ],
  edges: [
    {
      id: "e1",
      source: "RA",
      target: "AR",
      omega: "<->",
      structuralRule: {
        checks: [
          { kind: "coverage", ofClass: "Requirement", ofSide: "source", byClass: "ChangePoint", viaReference: "realizes", min: 1, skeleton: { holeAttributes: ["target", "rationale"] } },
          { kind: "refIntegrity", ofClass: "ChangePoint", ofSide: "target", reference: "realizes", targetClass: "Requirement" },
        ],
      },
      oracle: { kind: "llm_judge", llmJudge: { promptTemplate: "Does the ChangePoint's rationale address the Requirement?\nSource: {{source}}\nTarget: {{target}}" } },
      budgets: { k: 3, l: 2 },
    },
    {
      id: "e2",
      source: "AR",
      target: "DV",
      omega: "->",
      structuralRule: {
        checks: [
          { kind: "coverage", ofClass: "ChangePoint", ofSide: "source", byClass: "Hunk", viaReference: "realizesChangePoint", min: 1, skeleton: { holeAttributes: ["path", "diff"] } },
        ],
      },
      oracle: { kind: "llm_judge", llmJudge: { promptTemplate: "Does the Hunk implement the ChangePoint's rationale?\nSource: {{source}}\nTarget: {{target}}" } },
      budgets: { k: 3, l: 2 },
    },
    {
      id: "e3",
      source: "DV",
      target: "TS",
      omega: "->",
      structuralRule: {
        checks: [
          { kind: "coverage", ofClass: "Hunk", ofSide: "source", byClass: "TestCase", viaReference: "verifies", min: 0, skeleton: { holeAttributes: ["code"] } },
        ],
      },
      oracle: { kind: "executable", executable: { command: "true" } },
      budgets: { k: 2, l: 2 },
    },
    {
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
      budgets: { k: 4, l: 2 },
    },
  ],
  adaptationRules: [
    {
      id: "insert-impact-analyst",
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
          modelBinding: ollama(),
          tools: [],
          systemPrompt: "You are the Impact Analyst (IA). List callers of changed code elements as Dependency objects.",
        },
        connections: [{ existingAgentId: "AR", edgeId: "e_ar_ia", omega: "->" }],
      },
    },
  ],
  thresholds: { theta: 2, aMax: 3 },
};
