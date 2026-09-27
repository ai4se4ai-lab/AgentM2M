import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUGGY_DURATION_PATH = new URL("./duration_buggy.py", import.meta.url);

/**
 * A genuine executable oracle (dev.md's `oracle_executable.py`, scoped down
 * to a plain child_process run instead of a Docker harness): runs an
 * LLM-authored assertion against the paper's buggy `Duration.parse`, and
 * reports whether it reproduces the bug — the exact semantics of e4's
 * oracle ("repro test fails on original code"). Shared by the automated
 * integration test and the multi-model evaluation sweep
 * (`src/seed/duration-parse-scenario.ts`).
 */
export type OracleVerdict = "reproduces_bug" | "does_not_reproduce" | "invalid";

export function runReproAssertion(pythonAssertion: string): OracleVerdict {
  const buggySource = readFileSync(BUGGY_DURATION_PATH, "utf-8");
  const dir = mkdtempSync(join(tmpdir(), "agentm2m-oracle-"));
  const file = join(dir, "repro.py");
  writeFileSync(file, `${buggySource}\n\n${pythonAssertion}\n`);

  const result = spawnSync("python3", [file], { encoding: "utf-8", timeout: 10_000 });
  if (result.error) return "invalid";
  if (result.status === 1 && /AssertionError/.test(result.stderr)) return "reproduces_bug";
  if (result.status === 0) return "does_not_reproduce";
  return "invalid";
}
