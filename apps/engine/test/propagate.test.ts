import { describe, expect, it } from "vitest";
import type { AttributeValue, EdgeDef, Team, ViewMetamodel, ViewModel } from "@agentm2m/schema";
import { direction, propagate, type Sigma } from "../src/algorithms/propagate.js";

const itemMM: ViewMetamodel = { agentRole: "generic", classes: [{ name: "Item", attributes: [], references: [] }], constraints: [] };

function makeAgentModel(objects: ViewModel["objects"] = []): ViewModel {
  return { objects };
}

async function alwaysTrueOracle(): Promise<boolean> {
  return true;
}

async function fillWithPlaceholder(holes: { objectId: string; attribute: string }[]) {
  const values: Record<string, AttributeValue> = {};
  for (const h of holes) values[`${h.objectId}.${h.attribute}`] = "filled";
  return values;
}

describe("direction (Definition of Direction, Algorithm 4)", () => {
  const edge: EdgeDef = {
    id: "e",
    source: "A",
    target: "B",
    omega: "<->",
    structuralRule: { checks: [] },
    oracle: { kind: "executable", executable: { command: "true" } },
    budgets: { k: 1, l: 1 },
  };

  it("restores the older (stale) endpoint when omega permits", () => {
    const sigma: Sigma = { A: { model: makeAgentModel(), version: 2 }, B: { model: makeAgentModel(), version: 0 } };
    expect(direction(edge, sigma)).toBe("target"); // B is older
  });

  it("breaks ties in favor of the target when omega permits both directions", () => {
    const sigma: Sigma = { A: { model: makeAgentModel(), version: 1 }, B: { model: makeAgentModel(), version: 1 } };
    expect(direction(edge, sigma)).toBe("target");
  });

  it("returns null when omega forbids overwriting the stale endpoint (escalation case)", () => {
    const oneWay: EdgeDef = { ...edge, omega: "->" }; // only source may overwrite target
    const sigma: Sigma = { A: { model: makeAgentModel(), version: 0 }, B: { model: makeAgentModel(), version: 5 } };
    // A is stale but omega only allows source->target, not target->source
    expect(direction(oneWay, sigma)).toBeNull();
  });
});

describe("propagate (Algorithm 4)", () => {
  function edgeFixture(id: string, source: string, target: string, viaReference: string, l = 5): EdgeDef {
    return {
      id,
      source,
      target,
      omega: "<->",
      structuralRule: {
        checks: [
          {
            kind: "coverage",
            ofClass: "Item",
            ofSide: "source",
            byClass: "Item",
            viaReference,
            min: 1,
            skeleton: { holeAttributes: ["v"] },
          },
        ],
      },
      oracle: { kind: "executable", executable: { command: "true" } },
      budgets: { k: 1, l },
    };
  }

  it("propagates a single change along one edge, creating a covering skeleton on the target", async () => {
    const e1 = edgeFixture("e1", "A", "B", "link1");
    const team: Team = {
      id: "t",
      name: "t",
      agents: [],
      edges: [e1],
      adaptationRules: [],
      thresholds: { theta: 2, aMax: 3 },
    } as unknown as Team;

    const sigma: Sigma = {
      A: { model: makeAgentModel([{ id: "a1", className: "Item", attributes: {}, references: {} }]), version: 1 },
      B: { model: makeAgentModel(), version: 0 },
    };

    const result = await propagate({
      team,
      sigma,
      changedAgents: new Set(["A"]),
      priorEscalations: [],
      metamodels: { A: itemMM, B: itemMM },
      fillHoles: (_edge, holes) => fillWithPlaceholder(holes),
      evaluateOracle: alwaysTrueOracle,
    });

    expect(result.escalations).toHaveLength(0);
    expect(result.sigma.B.version).toBe(1);
    expect(result.sigma.B.model.objects).toHaveLength(1);
    expect(result.sigma.B.model.objects[0].references.link1).toEqual(["a1"]);
  });

  it("cascades through a chain A->B->C in one call, restoring both edges (Lemma: postcondition)", async () => {
    const e1 = edgeFixture("e1", "A", "B", "link1");
    const e2 = edgeFixture("e2", "B", "C", "link2");
    const team: Team = { id: "t", name: "t", agents: [], edges: [e1, e2], adaptationRules: [], thresholds: { theta: 2, aMax: 3 } } as unknown as Team;

    const sigma: Sigma = {
      A: { model: makeAgentModel([{ id: "a1", className: "Item", attributes: {}, references: {} }]), version: 1 },
      B: { model: makeAgentModel(), version: 0 },
      C: { model: makeAgentModel(), version: 0 },
    };

    const result = await propagate({
      team,
      sigma,
      changedAgents: new Set(["A"]),
      priorEscalations: [],
      metamodels: { A: itemMM, B: itemMM, C: itemMM },
      fillHoles: (_edge, holes) => fillWithPlaceholder(holes),
      evaluateOracle: alwaysTrueOracle,
    });

    expect(result.escalations).toHaveLength(0);
    expect(result.sigma.B.model.objects).toHaveLength(1);
    expect(result.sigma.C.model.objects).toHaveLength(1);
    expect(result.sigma.C.model.objects[0].references.link2).toEqual([result.sigma.B.model.objects[0].id]);
  });

  it("escalates instead of overwriting an endpoint that omega forbids touching", async () => {
    // Every B-Item (target) must be covered by an A-Item (source) via link1;
    // B has one uncovered item, A is stale, but omega='->' forbids writing
    // into A, so the change is illegitimate and must be escalated (P1).
    const oneWay: EdgeDef = {
      id: "e1",
      source: "A",
      target: "B",
      omega: "->",
      structuralRule: {
        checks: [
          { kind: "coverage", ofClass: "Item", ofSide: "target", byClass: "Item", viaReference: "link1", min: 1, skeleton: { holeAttributes: ["v"] } },
        ],
      },
      oracle: { kind: "executable", executable: { command: "true" } },
      budgets: { k: 1, l: 1 },
    };
    const team: Team = { id: "t", name: "t", agents: [], edges: [oneWay], adaptationRules: [], thresholds: { theta: 2, aMax: 3 } } as unknown as Team;

    // B is "ahead" (newer) but omega only allows source(A)->target(B); A itself is stale
    // and cannot legitimately be overwritten given the declared rights.
    const sigma: Sigma = {
      A: { model: makeAgentModel(), version: 0 },
      B: { model: makeAgentModel([{ id: "b1", className: "Item", attributes: {}, references: {} }]), version: 5 },
    };

    const result = await propagate({
      team,
      sigma,
      changedAgents: new Set(["B"]),
      priorEscalations: [],
      metamodels: { A: itemMM, B: itemMM },
      fillHoles: (_edge, holes) => fillWithPlaceholder(holes),
      evaluateOracle: alwaysTrueOracle,
    });

    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0].edgeId).toBe("e1");
    expect(result.sigma.A.version).toBe(0);
  });

  it("bounds work on cycles: an edge is escalated once its per-edge budget l is exhausted, and the call still terminates", async () => {
    // A 3-cycle A->B->C->A sharing one generic 'Item' class; each restore on the
    // downstream side re-triggers the next edge, and c->a's restore re-adds a
    // fresh, still-uncovered Item to A that re-violates e1 a second time.
    const e1 = edgeFixture("e1", "A", "B", "link1", 1); // budget of exactly 1
    const e2 = edgeFixture("e2", "B", "C", "link2", 5);
    const e3 = edgeFixture("e3", "C", "A", "link3", 5);
    const team: Team = { id: "t", name: "t", agents: [], edges: [e1, e2, e3], adaptationRules: [], thresholds: { theta: 2, aMax: 3 } } as unknown as Team;

    const sigma: Sigma = {
      A: { model: makeAgentModel([{ id: "a1", className: "Item", attributes: {}, references: {} }]), version: 1 },
      B: { model: makeAgentModel(), version: 0 },
      C: { model: makeAgentModel(), version: 0 },
    };

    const result = await propagate({
      team,
      sigma,
      changedAgents: new Set(["A"]),
      priorEscalations: [],
      metamodels: { A: itemMM, B: itemMM, C: itemMM },
      fillHoles: (_edge, holes) => fillWithPlaceholder(holes),
      evaluateOracle: alwaysTrueOracle,
    });

    // The call terminates and e1 is escalated exactly because its budget (l=1)
    // is exhausted by the second pass of the cycle, not because of an infinite loop.
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0].edgeId).toBe("e1");
    expect(result.escalations[0].diagnostics[0]).toContain("budget");
    expect(result.escalations[0].diagnostics[0]).toContain("exhausted");
  });
});
