import { describe, expect, it, vi } from "vitest";
import { emptyModel, type ViewMetamodel } from "@agentm2m/schema";
import { lift } from "../src/algorithms/lift.js";

const requirementMM: ViewMetamodel = {
  agentRole: "RA",
  classes: [
    {
      name: "Requirement",
      attributes: [{ name: "statement", type: "NL", required: true }],
      references: [],
    },
    {
      name: "ReproScenario",
      attributes: [{ name: "expected", type: "number", required: true }],
      references: [{ name: "of", target: "Requirement", multiplicity: "1" }],
    },
  ],
  constraints: [{ kind: "requiredNonEmpty", class: "Requirement", attribute: "statement" }],
};

describe("Lift (Algorithm 2)", () => {
  it("succeeds on a first response that already conforms, without calling repair", async () => {
    const response = JSON.stringify({
      objects: [
        { className: "Requirement", attributes: { statement: "parse honors every component" }, references: {} },
      ],
    });
    const repair = vi.fn();
    const result = await lift({ response, metamodel: requirementMM, current: emptyModel(), maxRetries: 3, repair });
    expect(result).not.toBeNull();
    expect(result!.model.objects).toHaveLength(1);
    expect(repair).not.toHaveBeenCalled();
  });

  it("repairs a response that violates a required-field constraint (P1: no value lost downstream)", async () => {
    const bad = JSON.stringify({
      objects: [{ className: "Requirement", attributes: { statement: "" }, references: {} }],
    });
    const good = JSON.stringify({
      objects: [{ className: "Requirement", attributes: { statement: "parse honors every component" }, references: {} }],
    });
    const repair = vi.fn().mockResolvedValueOnce(good);
    const result = await lift({ response: bad, metamodel: requirementMM, current: emptyModel(), maxRetries: 3, repair });
    expect(result).not.toBeNull();
    expect(result!.model.objects[0].attributes.statement).toBe("parse honors every component");
    expect(repair).toHaveBeenCalledTimes(1);
    const explanation = repair.mock.calls[0][1] as string;
    expect(explanation).toContain("statement");
  });

  it("repairs malformed JSON by feeding the parse error back to the agent", async () => {
    const bad = "{not json";
    const good = JSON.stringify({
      objects: [{ className: "Requirement", attributes: { statement: "x" }, references: {} }],
    });
    const repair = vi.fn().mockResolvedValueOnce(good);
    const result = await lift({ response: bad, metamodel: requirementMM, current: emptyModel(), maxRetries: 3, repair });
    expect(result).not.toBeNull();
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("returns null (bottom) after exhausting k_L retries", async () => {
    const alwaysBad = JSON.stringify({
      objects: [{ className: "Requirement", attributes: { statement: "" }, references: {} }],
    });
    const repair = vi.fn().mockResolvedValue(alwaysBad);
    const result = await lift({ response: alwaysBad, metamodel: requirementMM, current: emptyModel(), maxRetries: 3, repair });
    expect(result).toBeNull();
    expect(repair).toHaveBeenCalledTimes(3);
  });

  it("reuses stable ids across a lift that reproduces the same structural content (P2)", async () => {
    const response = JSON.stringify({
      objects: [{ className: "Requirement", attributes: { statement: "x" }, references: {} }],
    });
    const first = await lift({ response, metamodel: requirementMM, current: emptyModel(), maxRetries: 1, repair: vi.fn() });
    const second = await lift({ response, metamodel: requirementMM, current: first!.model, maxRetries: 1, repair: vi.fn() });
    expect(second!.model.objects[0].id).toBe(first!.model.objects[0].id);
    expect(second!.diff.added).toHaveLength(0);
    expect(second!.diff.changed).toHaveLength(0);
  });
});
