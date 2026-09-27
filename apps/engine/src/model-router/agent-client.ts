import type { AttributeValue, ClassDef, EdgeDef, FieldType, ModelBinding, ViewMetamodel, ViewModel } from "@agentm2m/schema";
import type { AgentTurnClient } from "../algorithms/run-team.js";
import { holeKey, type Hole } from "../algorithms/structural-rule.js";
import type { ModelRouter } from "./router.js";

export interface RouterAgentClientOptions {
  router: ModelRouter;
  agentBindings: Record<string, ModelBinding>;
  agentMetamodels: Record<string, ViewMetamodel>;
  agentSystemPrompts?: Record<string, string>;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function examplePlaceholder(type: FieldType): AttributeValue {
  switch (type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "id":
      return "";
    default:
      return "...";
  }
}

/**
 * A concrete example instance, not the formal JSON Schema, is what actually
 * steers small/local models toward producing data rather than echoing the
 * schema shape back (verified against a real qwen2.5:3b run — dumping
 * Schema(MM_a) verbatim made it parrot the schema itself).
 */
function exampleShape(mm: ViewMetamodel): { objects: unknown[] } {
  const example = (c: ClassDef) => ({
    className: c.name,
    attributes: Object.fromEntries(c.attributes.map((a) => [a.name, examplePlaceholder(a.type)])),
    references: Object.fromEntries(c.references.map((r) => [r.name, []])),
  });
  return { objects: mm.classes.map(example) };
}

/** The real ModelRouter-backed implementation of AgentTurnClient used outside unit tests. */
export class RouterAgentClient implements AgentTurnClient {
  constructor(private readonly opts: RouterAgentClientOptions) {}

  async task(agentId: string, payload: unknown, model: ViewModel): Promise<string> {
    const binding = this.requireBinding(agentId);
    const mm = this.requireMetamodel(agentId);
    const system = this.opts.agentSystemPrompts?.[agentId] ?? `You are the ${mm.agentRole} agent in a software engineering team.`;
    const prompt = [
      system,
      `Your current view model (JSON): ${JSON.stringify(model)}`,
      `Task: ${JSON.stringify(payload)}`,
      `Respond with ONLY a JSON object shaped exactly like this example, with the placeholder values replaced by real content (you may omit classes you don't need):`,
      JSON.stringify(exampleShape(mm)),
    ].join("\n\n");
    const raw = await this.opts.router.generate(binding, prompt, { system, json: true });
    return stripFences(raw);
  }

  async repair(agentId: string, previousResponse: string, explanation: string): Promise<string> {
    const binding = this.requireBinding(agentId);
    const prompt = [
      "Your previous JSON response was invalid.",
      `Previous response: ${previousResponse}`,
      `Validation errors:\n${explanation}`,
      "Respond again with ONLY a corrected JSON object, no prose, no markdown fences.",
    ].join("\n\n");
    const raw = await this.opts.router.generate(binding, prompt, { json: true });
    return stripFences(raw);
  }

  async fillHoles(_edge: EdgeDef, restoreAgentId: string, holes: Hole[], diagnostics: string[]): Promise<Record<string, AttributeValue>> {
    const binding = this.requireBinding(restoreAgentId);
    const prompt = [
      `Fill in ONLY the following field(s) for a ${holes[0]?.className ?? "object"}.`,
      `Context: ${JSON.stringify(holes.map((h) => h.context))}`,
      diagnostics.length > 0 ? `Your previous attempt was rejected because: ${diagnostics.join("; ")}` : "",
      `Fields to fill: ${holes.map((h) => h.attribute).join(", ")}`,
      "Respond with ONLY a JSON object mapping each field name to its value, no prose, no markdown fences.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const raw = await this.opts.router.generate(binding, prompt, { json: true });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch {
      parsed = {};
    }

    const values: Record<string, AttributeValue> = {};
    for (const hole of holes) {
      const value = parsed[hole.attribute];
      values[holeKey(hole)] =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? value
          : JSON.stringify(value ?? null);
    }
    return values;
  }

  private requireBinding(agentId: string): ModelBinding {
    const binding = this.opts.agentBindings[agentId];
    if (!binding) throw new Error(`RouterAgentClient: no model binding registered for '${agentId}'`);
    return binding;
  }

  private requireMetamodel(agentId: string): ViewMetamodel {
    const mm = this.opts.agentMetamodels[agentId];
    if (!mm) throw new Error(`RouterAgentClient: no metamodel registered for '${agentId}'`);
    return mm;
  }
}
