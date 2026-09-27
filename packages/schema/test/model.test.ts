import { describe, expect, it } from "vitest";
import {
  checkConstraints,
  diffModels,
  emptyModel,
  instantiate,
  type DecodedResponse,
  type ViewMetamodel,
} from "../src/index.js";

describe("instantiate (stable ids)", () => {
  it("mints fresh ids on an empty model", () => {
    const decoded: DecodedResponse = {
      objects: [
        { className: "Requirement", attributes: { statement: "parse honors every component" }, references: {} },
      ],
    };
    const result = instantiate(decoded, emptyModel());
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].id).toBeTruthy();
    expect(result.objects[0].className).toBe("Requirement");
  });

  it("reuses the id of a structurally-identical previous object (P2: trace links survive iterations)", () => {
    const decoded: DecodedResponse = {
      objects: [{ className: "Requirement", attributes: { statement: "x" }, references: {} }],
    };
    const first = instantiate(decoded, emptyModel());
    const second = instantiate(decoded, first);
    expect(second.objects[0].id).toBe(first.objects[0].id);
  });

  it("mints a new id when attributes change, leaving the old object addressable in the diff", () => {
    const decoded1: DecodedResponse = {
      objects: [{ className: "Requirement", attributes: { statement: "x" }, references: {} }],
    };
    const first = instantiate(decoded1, emptyModel());
    const decoded2: DecodedResponse = {
      objects: [{ className: "Requirement", attributes: { statement: "y" }, references: {} }],
    };
    const second = instantiate(decoded2, first);
    expect(second.objects[0].id).not.toBe(first.objects[0].id);
    const diff = diffModels(first, second);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
  });

  it("remaps positional reference indices to assigned ids", () => {
    const decoded: DecodedResponse = {
      objects: [
        { className: "Requirement", attributes: { statement: "x" }, references: {} },
        { className: "ReproScenario", attributes: { input: "1h30m" }, references: { verifies: ["0"] } },
      ],
    };
    const result = instantiate(decoded, emptyModel());
    const scenario = result.objects.find((o) => o.className === "ReproScenario")!;
    const requirement = result.objects.find((o) => o.className === "Requirement")!;
    expect(scenario.references.verifies).toEqual([requirement.id]);
  });
});

describe("checkConstraints (Phi_a)", () => {
  const mm: ViewMetamodel = {
    agentRole: "TS",
    classes: [
      { name: "Requirement", attributes: [], references: [] },
      {
        name: "TestCase",
        attributes: [{ name: "verdict", type: "string", required: true }],
        references: [{ name: "verifies", target: "Requirement", multiplicity: "1..*" }],
      },
    ],
    constraints: [
      { kind: "minCount", class: "TestCase", reference: "verifies", min: 1 },
      { kind: "refIntegrity", class: "TestCase", reference: "verifies" },
      { kind: "requiredNonEmpty", class: "TestCase", attribute: "verdict" },
    ],
  };

  it("flags a test case that verifies no requirement", () => {
    const model = {
      objects: [{ id: "t1", className: "TestCase", attributes: { verdict: "pass" }, references: { verifies: [] } }],
    };
    const violations = checkConstraints(model, mm);
    expect(violations.some((v) => v.constraint.kind === "minCount")).toBe(true);
  });

  it("flags a dangling reference", () => {
    const model = {
      objects: [
        { id: "t1", className: "TestCase", attributes: { verdict: "pass" }, references: { verifies: ["missing"] } },
      ],
    };
    const violations = checkConstraints(model, mm);
    expect(violations.some((v) => v.constraint.kind === "refIntegrity")).toBe(true);
  });

  it("passes a well-formed model with no violations", () => {
    const model = {
      objects: [
        { id: "r1", className: "Requirement", attributes: {}, references: {} },
        { id: "t1", className: "TestCase", attributes: { verdict: "pass" }, references: { verifies: ["r1"] } },
      ],
    };
    expect(checkConstraints(model, mm)).toHaveLength(0);
  });
});
