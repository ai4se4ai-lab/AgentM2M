import { describe, expect, it } from "vitest";
import type { StructuralRule, ViewModel } from "@agentm2m/schema";
import { applyRuleRestore, evaluateStructuralRule, fillHoleValues } from "../src/algorithms/structural-rule.js";

const coverageRule: StructuralRule = {
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
};

describe("evaluateStructuralRule (R_e^str)", () => {
  it("flags a requirement with no covering test case", () => {
    const source: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const target: ViewModel = { objects: [] };
    const violations = evaluateStructuralRule(coverageRule, source, target);
    expect(violations).toHaveLength(1);
  });

  it("passes when coverage is met", () => {
    const source: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const target: ViewModel = {
      objects: [{ id: "t1", className: "TestCase", attributes: {}, references: { verifies: ["r1"] } }],
    };
    expect(evaluateStructuralRule(coverageRule, source, target)).toHaveLength(0);
  });

  it("flags a dangling cross-model reference via refIntegrity, without attempting to repair it", () => {
    const rule: StructuralRule = {
      checks: [{ kind: "refIntegrity", ofClass: "TestCase", ofSide: "target", reference: "verifies", targetClass: "Requirement" }],
    };
    const source: ViewModel = { objects: [] };
    const target: ViewModel = {
      objects: [{ id: "t1", className: "TestCase", attributes: {}, references: { verifies: ["missing-req"] } }],
    };
    const violations = evaluateStructuralRule(rule, source, target);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("missing");
  });
});

describe("applyRuleRestore (Rule_e)", () => {
  it("creates a skeleton with holes only on the side being restored", () => {
    const source: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const target: ViewModel = { objects: [] };
    const { model, holes } = applyRuleRestore(coverageRule, source, target, "target");
    expect(model.objects).toHaveLength(1);
    expect(model.objects[0].className).toBe("TestCase");
    expect(model.objects[0].references.verifies).toEqual(["r1"]);
    expect(holes).toHaveLength(1);
    expect(holes[0].attribute).toBe("code");
  });

  it("does nothing when restoring the side that isn't the covering side", () => {
    const source: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const target: ViewModel = { objects: [] };
    const { model, holes } = applyRuleRestore(coverageRule, source, target, "source");
    expect(model.objects).toHaveLength(1); // unchanged source, untouched
    expect(holes).toHaveLength(0);
  });

  it("does not duplicate a skeleton for a requirement that is already covered", () => {
    const source: ViewModel = { objects: [{ id: "r1", className: "Requirement", attributes: {}, references: {} }] };
    const target: ViewModel = {
      objects: [{ id: "t1", className: "TestCase", attributes: { code: "x" }, references: { verifies: ["r1"] } }],
    };
    const { model, holes } = applyRuleRestore(coverageRule, source, target, "target");
    expect(model.objects).toHaveLength(1);
    expect(holes).toHaveLength(0);
  });
});

describe("fillHoleValues", () => {
  it("is the identity when there are no holes", () => {
    const model: ViewModel = { objects: [{ id: "t1", className: "TestCase", attributes: {}, references: {} }] };
    expect(fillHoleValues(model, [], {})).toEqual(model);
  });

  it("writes values only into the addressed hole attributes", () => {
    const model: ViewModel = { objects: [{ id: "t1", className: "TestCase", attributes: { code: null }, references: {} }] };
    const holes = [{ objectId: "t1", attribute: "code", className: "TestCase", context: {} }];
    const filled = fillHoleValues(model, holes, { "t1.code": "assert true" });
    expect(filled.objects[0].attributes.code).toBe("assert true");
  });
});
