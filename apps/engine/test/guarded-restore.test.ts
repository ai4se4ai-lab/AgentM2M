import { describe, expect, it, vi } from "vitest";
import type { EdgeDef, ViewMetamodel, ViewModel } from "@agentm2m/schema";
import { guardedRestore } from "../src/algorithms/guarded-restore.js";

const requirementMM: ViewMetamodel = {
  agentRole: "RA",
  classes: [{ name: "Requirement", attributes: [], references: [] }],
  constraints: [],
};

const testCaseMM: ViewMetamodel = {
  agentRole: "TS",
  classes: [
    {
      name: "TestCase",
      attributes: [{ name: "code", type: "NL", required: true }],
      references: [{ name: "verifies", target: "Requirement", multiplicity: "1..*" }],
    },
  ],
  constraints: [],
};

function makeEdge(overrides: Partial<EdgeDef> = {}): EdgeDef {
  return {
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
    oracle: { kind: "executable", executable: { command: "true" } },
    budgets: { k: 3, l: 2 },
    ...overrides,
  };
}

describe("GuardedRestore (Algorithm 3)", () => {
  it("short-circuits (hippocratic) when already structurally and semantically consistent, without calling FillHoles", async () => {
    const edge = makeEdge();
    const sourceModel: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const targetModel: ViewModel = {
      objects: [{ id: "t1", className: "TestCase", attributes: { code: "assert x" }, references: { verifies: ["r1"] } }],
    };
    const fillHoles = vi.fn();
    const evaluateOracle = vi.fn().mockResolvedValue(true);
    const result = await guardedRestore({
      edge,
      sourceModel,
      targetModel,
      restoreSide: "target",
      restoreMetamodel: testCaseMM,
      fillHoles,
      evaluateOracle,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(fillHoles).not.toHaveBeenCalled();
    expect(evaluateOracle).toHaveBeenCalledTimes(1);
  });

  it("creates a skeleton with a hole, fills it via the LLM callback, and accepts once the oracle passes", async () => {
    const edge = makeEdge();
    const sourceModel: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const targetModel: ViewModel = { objects: [] };
    const fillHoles = vi.fn().mockResolvedValue({ "testcase-skeleton-r1.code": "assert parse('1h30m').seconds == 5400" });
    const evaluateOracle = vi.fn().mockResolvedValue(true);
    const result = await guardedRestore({
      edge,
      sourceModel,
      targetModel,
      restoreSide: "target",
      restoreMetamodel: testCaseMM,
      fillHoles,
      evaluateOracle,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.model.objects).toHaveLength(1);
      expect(result.model.objects[0].attributes.code).toContain("5400");
      expect(result.model.objects[0].references.verifies).toEqual(["r1"]);
    }
    expect(fillHoles).toHaveBeenCalledTimes(1);
  });

  it("retries with accumulated diagnostics when the oracle rejects a filled candidate", async () => {
    const edge = makeEdge();
    const sourceModel: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const targetModel: ViewModel = { objects: [] };
    const fillHoles = vi
      .fn()
      .mockResolvedValueOnce({ "testcase-skeleton-r1.code": "wrong assertion" })
      .mockResolvedValueOnce({ "testcase-skeleton-r1.code": "assert parse('1h30m').seconds == 5400" });
    const evaluateOracle = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await guardedRestore({
      edge,
      sourceModel,
      targetModel,
      restoreSide: "target",
      restoreMetamodel: testCaseMM,
      fillHoles,
      evaluateOracle,
    });
    expect(result.ok).toBe(true);
    expect(fillHoles).toHaveBeenCalledTimes(2);
    expect(fillHoles.mock.calls[1][1]).toContain("oracle rejected candidate");
  });

  it("returns (bottom, D) after exhausting k attempts", async () => {
    const edge = makeEdge({ budgets: { k: 2, l: 2 } });
    const sourceModel: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const targetModel: ViewModel = { objects: [] };
    const fillHoles = vi.fn().mockResolvedValue({ "testcase-skeleton-r1.code": "still wrong" });
    const evaluateOracle = vi.fn().mockResolvedValue(false);
    const result = await guardedRestore({
      edge,
      sourceModel,
      targetModel,
      restoreSide: "target",
      restoreMetamodel: testCaseMM,
      fillHoles,
      evaluateOracle,
    });
    expect(result.ok).toBe(false);
    expect(fillHoles).toHaveBeenCalledTimes(2);
    if (!result.ok) expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("never overwrites the side it wasn't asked to restore", async () => {
    const edge = makeEdge();
    const sourceModel: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: { locked: true }, references: {} }] };
    const targetModel: ViewModel = { objects: [] };
    const fillHoles = vi.fn().mockResolvedValue({ "testcase-skeleton-r1.code": "x" });
    const evaluateOracle = vi.fn().mockResolvedValue(true);
    const result = await guardedRestore({
      edge,
      sourceModel,
      targetModel,
      restoreSide: "target",
      restoreMetamodel: testCaseMM,
      fillHoles,
      evaluateOracle,
    });
    expect(result.ok).toBe(true);
    // the returned model is the restored TARGET, source is untouched by construction (not returned/mutated)
    expect(sourceModel.objects[0].attributes.locked).toBe(true);
  });
});
