/**
 * Real, no-mocks evaluation sweep: runs the paper's Duration.parse running
 * example (RA<->TS, edge e4) through the actual engine (RunTeam -> Lift ->
 * Propagate -> GuardedRestore's FillHoles), once per usable local Ollama
 * model, `TRIALS` times each, and records real success/cost/latency.
 *
 * This is deliberately NOT a claim of reproducing the paper's RQ1-RQ6 at
 * scale — it's a small, honest, multi-model validation of the working
 * prototype, run against whatever local open-weight models happen to be
 * installed. See docs/architecture.md and the evaluation report this
 * script writes for the exact scope.
 *
 * Usage: npx tsx scripts/model-sweep.ts
 * Env:   OLLAMA_HOST (default http://localhost:11434), SWEEP_TRIALS (default 2),
 *        SWEEP_BUDGET (default 8), SWEEP_TIMEOUT_MS (default 240000)
 */
import { writeFileSync } from "node:fs";
import { runTeam } from "../src/algorithms/run-team.js";
import { ModelRouter } from "../src/model-router/router.js";
import { OllamaProvider } from "../src/model-router/ollama.provider.js";
import {
  DURATION_PARSE_TASK,
  buildDurationParseClient,
  buildDurationParseTeam,
  durationParsePhi,
  evaluateDurationParseOracle,
} from "../src/seed/duration-parse-scenario.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const TRIALS = Number(process.env.SWEEP_TRIALS ?? 2);
const BUDGET = Number(process.env.SWEEP_BUDGET ?? 8);
const TIMEOUT_MS = Number(process.env.SWEEP_TIMEOUT_MS ?? 240_000);

interface TrialResult {
  model: string;
  trial: number;
  accepted: boolean;
  cost: number;
  iterations: number;
  wallClockMs: number;
  error?: string;
}

function isUsableChatModel(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("embed")) return false; // embedding models can't do this generative task
  if (lower.endsWith(":cloud")) return false; // routes to Ollama's hosted cloud proxy, not a local model
  return true;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function runOneTrial(modelId: string, trial: number): Promise<TrialResult> {
  const team = buildDurationParseTeam(modelId, OLLAMA_HOST);
  const router = new ModelRouter().register("ollama", new OllamaProvider());
  const client = buildDurationParseClient(team, router);
  const start = Date.now();
  try {
    const result = await withTimeout(
      runTeam({
        task: DURATION_PARSE_TASK,
        team,
        phi: durationParsePhi,
        budget: BUDGET,
        client,
        evaluateOracle: evaluateDurationParseOracle,
      }),
      TIMEOUT_MS,
    );
    return {
      model: modelId,
      trial,
      accepted: result.accepted,
      cost: result.cost,
      iterations: result.iterations,
      wallClockMs: Date.now() - start,
    };
  } catch (err) {
    return {
      model: modelId,
      trial,
      accepted: false,
      cost: -1,
      iterations: -1,
      wallClockMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface ModelSummary {
  model: string;
  trials: number;
  successes: number;
  successRate: number;
  meanCostOnSuccess: number | null;
  meanIterationsOnSuccess: number | null;
  meanWallClockMsOnSuccess: number | null;
  errors: string[];
}

function summarize(model: string, trials: TrialResult[]): ModelSummary {
  const successes = trials.filter((t) => t.accepted);
  const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    model,
    trials: trials.length,
    successes: successes.length,
    successRate: successes.length / trials.length,
    meanCostOnSuccess: mean(successes.map((t) => t.cost)),
    meanIterationsOnSuccess: mean(successes.map((t) => t.iterations)),
    meanWallClockMsOnSuccess: mean(successes.map((t) => t.wallClockMs)),
    errors: trials.filter((t) => t.error).map((t) => `trial ${t.trial}: ${t.error}`),
  };
}

function toMarkdown(summaries: ModelSummary[]): string {
  const rows = summaries
    .map(
      (s) =>
        `| ${s.model} | ${s.successes}/${s.trials} | ${(s.successRate * 100).toFixed(0)}% | ${s.meanCostOnSuccess?.toFixed(1) ?? "-"} | ${s.meanIterationsOnSuccess?.toFixed(1) ?? "-"} | ${s.meanWallClockMsOnSuccess ? (s.meanWallClockMsOnSuccess / 1000).toFixed(1) + "s" : "-"} |`,
    )
    .join("\n");
  return [
    "| Model | Success | Rate | Mean cost (turns) | Mean iterations | Mean latency |",
    "| --- | --- | --- | --- | --- | --- |",
    rows,
  ].join("\n");
}

async function main() {
  const status = await OllamaProvider.testConnection(OLLAMA_HOST);
  if (!status.ok) {
    console.error(`Ollama unreachable at ${OLLAMA_HOST}: ${status.error}`);
    process.exit(1);
  }
  const allModels = status.models;
  const usable = allModels.filter(isUsableChatModel);
  const excluded = allModels.filter((m) => !usable.includes(m));
  console.log(`Discovered ${allModels.length} Ollama models; using ${usable.length}, excluding ${excluded.length}: ${excluded.join(", ")}`);
  console.log(`Trials per model: ${TRIALS}, budget: ${BUDGET} turns, per-trial timeout: ${TIMEOUT_MS}ms\n`);

  const allTrials: TrialResult[] = [];
  for (const model of usable) {
    for (let trial = 1; trial <= TRIALS; trial++) {
      process.stdout.write(`[${model}] trial ${trial}/${TRIALS}... `);
      const result = await runOneTrial(model, trial);
      allTrials.push(result);
      console.log(result.accepted ? `ok (cost=${result.cost}, ${(result.wallClockMs / 1000).toFixed(1)}s)` : `FAILED (${result.error ?? "not accepted within budget"})`);
    }
  }

  const summaries = usable.map((model) => summarize(model, allTrials.filter((t) => t.model === model)));
  summaries.sort((a, b) => b.successRate - a.successRate);

  const outDir = new URL("../../../evaluation/local-model-sweep/", import.meta.url);
  writeFileSync(new URL("results.json", outDir), JSON.stringify({ config: { host: OLLAMA_HOST, trials: TRIALS, budget: BUDGET, excludedModels: excluded }, trials: allTrials, summaries }, null, 2));
  writeFileSync(new URL("results.md", outDir), `# Local Ollama model sweep — Duration.parse running example\n\n${toMarkdown(summaries)}\n`);

  console.log("\n" + toMarkdown(summaries));
  console.log(`\nWrote evaluation/local-model-sweep/results.json and results.md`);
}

main();
