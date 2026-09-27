import { describe, expect, it } from "vitest";
import { runTeam } from "../../src/algorithms/run-team.js";
import { ModelRouter } from "../../src/model-router/router.js";
import { OllamaProvider } from "../../src/model-router/ollama.provider.js";
import {
  DURATION_PARSE_TASK,
  buildDurationParseClient,
  buildDurationParseTeam,
  durationParsePhi,
  evaluateDurationParseOracle,
} from "../../src/seed/duration-parse-scenario.js";
import { runReproAssertion } from "../../src/seed/python-repro-oracle.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";

async function ollamaAvailable(): Promise<boolean> {
  const status = await OllamaProvider.testConnection(OLLAMA_HOST);
  return status.ok && status.models.includes(OLLAMA_MODEL);
}

/**
 * A real, no-mocks, no-API-key end-to-end check of the paper's core loop
 * (Lift -> Propagate -> GuardedRestore's LLM-scoped FillHoles) against a
 * live local Ollama model, on the paper's running example (Duration.parse
 * ignoring minutes). This is the "faithful core slice"'s free CI-style
 * check called for in docs/dev.md §13 — it exercises the real oracle (a
 * genuine child_process run of the buggy parser), not a scripted one.
 * The scenario itself lives in src/seed/duration-parse-scenario.ts, shared
 * with the multi-model evaluation sweep (scripts/model-sweep.ts).
 */
describe.runIf(await ollamaAvailable())("RunTeam against a real local Ollama model (integration)", () => {
  it(
    "produces a repro test for the Duration.parse bug end-to-end, verified by a real executable oracle",
    async () => {
      const team = buildDurationParseTeam(OLLAMA_MODEL, OLLAMA_HOST);
      const router = new ModelRouter().register("ollama", new OllamaProvider());
      const client = buildDurationParseClient(team, router);

      const result = await runTeam({
        task: DURATION_PARSE_TASK,
        team,
        phi: durationParsePhi,
        budget: 8,
        client,
        evaluateOracle: evaluateDurationParseOracle,
      });

      expect(result.accepted).toBe(true);
      expect(result.sigma.RA.model.objects).toHaveLength(1);

      const testCase = result.sigma.TS.model.objects.find(
        (tc) => tc.className === "TestCase" && (tc.references.verifies ?? []).includes(result.sigma.RA.model.objects[0].id),
      );
      expect(testCase).toBeDefined();
      expect(runReproAssertion(String(testCase!.attributes.code))).toBe("reproduces_bug");
    },
    { timeout: 120_000 },
  );
});
