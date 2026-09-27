import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EdgeDef, ViewModel } from "@agentm2m/schema";
import type { ModelRouter } from "./router.js";

/**
 * O_e dispatch for edges authored through the dashboard (dev.md §8's
 * `oracle_executable.py` concept, scoped down to a direct child_process run
 * instead of the bench service's Docker harness): the two current models
 * are serialized to temp files and the edge's command decides pass/fail via
 * its exit code. `llm_judge` calls the router with the edge's prompt
 * template and expects a response starting with "yes"/"no".
 */
export function makeOracleDispatcher(router: ModelRouter) {
  return async function evaluateOracle(edge: EdgeDef, sourceModel: ViewModel, targetModel: ViewModel): Promise<boolean> {
    if (edge.oracle.kind === "executable" || edge.oracle.kind === "hybrid") {
      const cmd = edge.oracle.executable?.command;
      if (!cmd) return false;
      const dir = mkdtempSync(join(tmpdir(), "agentm2m-oracle-"));
      const sourcePath = join(dir, "source.json");
      const targetPath = join(dir, "target.json");
      writeFileSync(sourcePath, JSON.stringify(sourceModel, null, 2));
      writeFileSync(targetPath, JSON.stringify(targetModel, null, 2));
      const result = spawnSync(cmd, {
        shell: true,
        cwd: dir,
        // Deliberately not spreading process.env: an oracle command is an
        // author-supplied shell command (inherent to O_e per the paper — see
        // docs/architecture.md's Security notes), so it gets the minimum it
        // needs (PATH to find interpreters, the two model files) rather than
        // the host's full environment, which may carry provider API keys.
        env: { PATH: process.env.PATH, MODEL_SOURCE_PATH: sourcePath, MODEL_TARGET_PATH: targetPath },
        timeout: 30_000,
      });
      const execOk = result.status === 0;
      if (edge.oracle.kind === "executable") return execOk;
      if (!execOk) return false; // hybrid: executable gate must pass before consulting the judge
    }

    if (edge.oracle.kind === "llm_judge" || edge.oracle.kind === "hybrid") {
      const judge = edge.oracle.llmJudge;
      if (!judge) return false;
      const prompt = judge.promptTemplate
        .replace("{{source}}", JSON.stringify(sourceModel))
        .replace("{{target}}", JSON.stringify(targetModel));
      const binding = judge.modelBinding ?? { provider: "ollama" as const, modelId: "qwen2.5:3b", temperature: 0, maxTokens: 64 };
      const response = await router.generate(binding, `${prompt}\n\nAnswer with exactly one word: yes or no.`);
      return /^\s*yes/i.test(response);
    }

    return false;
  };
}
