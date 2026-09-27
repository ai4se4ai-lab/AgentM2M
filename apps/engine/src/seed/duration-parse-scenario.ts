import type { AttributeValue, EdgeDef, Team, ViewModel } from "@agentm2m/schema";
import { runReproAssertion } from "./python-repro-oracle.js";
import { holeKey, type Hole } from "../algorithms/structural-rule.js";
import type { AgentTurnClient } from "../algorithms/run-team.js";
import type { Sigma } from "../algorithms/propagate.js";
import { RouterAgentClient } from "../model-router/agent-client.js";
import type { ModelRouter } from "../model-router/router.js";

/**
 * The paper's running-example bug, reduced to the RA<->TS slice (edge e4)
 * that this prototype exercises end-to-end against real models. Shared by
 * the automated integration test (a single fixed model) and the
 * multi-model evaluation sweep (`scripts/model-sweep.ts`), so the scenario
 * definition and its model-specific prompt tuning live in exactly one place.
 */
export const DURATION_PARSE_TASK =
  "Bug report: Duration.parse('1h30m') currently returns 3600 seconds but must return 5400 seconds " +
  "(1 hour 30 minutes = 5400 seconds). File the requirement precisely, stating the expected value 5400.";

export function buildDurationParseTeam(modelId: string, ollamaHost: string): Team {
  return {
    id: "devteam-min",
    name: "DevTeam (RA/TS slice)",
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
          ],
          constraints: [{ kind: "requiredNonEmpty", class: "Requirement", attribute: "statement" }],
        },
        modelBinding: { provider: "ollama", modelId, ollamaHost, temperature: 0.1, maxTokens: 512 },
        tools: [],
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
              attributes: [{ name: "code", type: "NL", required: true }],
              references: [{ name: "verifies", target: "Requirement", multiplicity: "1..*" }],
            },
          ],
          constraints: [],
        },
        modelBinding: { provider: "ollama", modelId, ollamaHost, temperature: 0.1, maxTokens: 512 },
        tools: [],
      },
    ],
    edges: [
      {
        id: "e4",
        source: "RA",
        target: "TS",
        omega: "<->",
        structuralRule: {
          checks: [
            {
              kind: "coverage",
              ofClass: "Requirement",
              ofSide: "source",
              byClass: "TestCase",
              viaReference: "verifies",
              min: 1,
              skeleton: { holeAttributes: ["code"] },
            },
          ],
        },
        oracle: { kind: "executable", executable: { command: "python3 duration_repro_oracle.py" } },
        budgets: { k: 4, l: 2 },
      } satisfies EdgeDef,
    ],
    adaptationRules: [],
    thresholds: { theta: 2, aMax: 3 },
  };
}

/**
 * GuardedRestore's FillHoles is scoped to a single field ("code") with
 * little surrounding context, which small/local models need spelled out
 * concretely (verified directly against Ollama: a bare "fill in this field"
 * prompt produced Java-flavored nonsense; naming the language and giving
 * one example fixed it). This wrapper keeps RouterAgentClient itself
 * generic while giving this concrete scenario the domain-specific hint it
 * needs, for whichever model is bound to the team.
 */
export function buildDurationParseClient(team: Team, router: ModelRouter): AgentTurnClient {
  const routerClient = new RouterAgentClient({
    router,
    agentBindings: Object.fromEntries(team.agents.map((a) => [a.id, a.modelBinding])),
    agentMetamodels: Object.fromEntries(team.agents.map((a) => [a.id, a.metamodel])),
    agentSystemPrompts: {
      RA: "You are the Requirements Analyst. Write ONE precise Requirement whose statement states the exact expected numeric result in seconds.",
      TS: "You are the Test Specialist.",
    },
  });

  return {
    task: (agentId, payload, model) => routerClient.task(agentId, payload, model),
    repair: (agentId, prev, explanation) => routerClient.repair(agentId, prev, explanation),
    fillHoles: async (edge: EdgeDef, restoreAgentId: string, holes: Hole[]) => {
      if (holes.every((h) => h.attribute !== "code")) return routerClient.fillHoles(edge, restoreAgentId, holes, []);
      const requirementStatement = holes[0]?.context?.triggeredBy
        ? (holes[0].context.triggeredBy as { attributes: Record<string, unknown> }).attributes.statement
        : "";
      const binding = team.agents.find((a) => a.id === restoreAgentId)!.modelBinding;
      const prompt = [
        "You are writing a Python regression test as a single assert statement.",
        "A Python function `parse(text)` exists that parses a duration string like '1h30m' and returns an integer number of seconds. It currently has a bug.",
        `Requirement to encode as a test: ${requirementStatement}`,
        "Example of the exact format expected: assert parse('2h') == 7200",
        'Respond with ONLY a JSON object: {"code": "assert parse(...) == ..."} using the exact expected value from the requirement above. No prose, no markdown fences, no other keys.',
      ].join("\n\n");
      const raw = await router.generate(binding, prompt, { json: true });
      const parsed = JSON.parse(raw) as { code: string };
      const values: Record<string, AttributeValue> = {};
      for (const h of holes) values[holeKey(h)] = h.attribute === "code" ? parsed.code : null;
      return values;
    },
  };
}

/** phi must check genuine cross-model referential integrity (P2), not merely "a TestCase exists". */
export function durationParsePhi(sigma: Sigma): boolean {
  return sigma.TS.model.objects.some(
    (tc) =>
      tc.className === "TestCase" &&
      (tc.references.verifies ?? []).some((id) => sigma.RA.model.objects.some((r) => r.id === id)),
  );
}

export async function evaluateDurationParseOracle(
  _edge: EdgeDef,
  _sourceModel: ViewModel,
  targetModel: ViewModel,
): Promise<boolean> {
  const testCases = targetModel.objects.filter((o) => o.className === "TestCase");
  if (testCases.length === 0) return false;
  return testCases.every((tc) => runReproAssertion(String(tc.attributes.code ?? "")) === "reproduces_bug");
}
