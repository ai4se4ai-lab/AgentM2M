import { createRequire } from "node:module";
import {
  checkConstraints,
  deriveJsonSchema,
  diffModels,
  instantiate,
  type ConstraintViolation,
  type DecodedResponse,
  type JsonSchemaLike,
  type ModelDiff,
  type ViewMetamodel,
  type ViewModel,
} from "@agentm2m/schema";

// ajv's CJS default export doesn't interop cleanly under NodeNext module
// resolution (its .d.ts loses the constructor signature through `import
// type`); requiring it directly and typing the instance as `any` avoids
// fighting that mismatch for what is a small, fully internal interop shim.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvCtor: any = require("ajv");
const ajv = new AjvCtor({ allErrors: true, strict: false });

export interface LiftResult {
  model: ViewModel;
  diff: ModelDiff;
}

export interface LiftParams {
  response: string;
  metamodel: ViewMetamodel;
  current: ViewModel;
  /** k_L: number of repair attempts, matching Algorithm 2's `for j=1 to k_L` */
  maxRetries: number;
  /** pi_a.Repair(r, Explain(V)): re-prompts the *same* model binding with structured validation errors */
  repair: (previousResponse: string, explanation: string) => Promise<string>;
}

/**
 * Small local models very reliably reach for `[]` to mean "no references" or
 * "no attributes" even when told the schema requires an object, and —
 * verified directly against qwen2.5:3b — cannot self-correct this specific
 * mistake across repair attempts (it repeats the exact same array every
 * time). Both representations mean the same thing, so Decode normalizes the
 * common one rather than spending the whole repair budget on it.
 */
function normalizeEmptyCollections(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const top = value as { objects?: unknown };
  if (!Array.isArray(top.objects)) return value;
  const objects = top.objects.map((o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    const obj = { ...(o as Record<string, unknown>) };
    for (const key of ["attributes", "references"]) {
      if (Array.isArray(obj[key])) obj[key] = {};
    }
    return obj;
  });
  return { ...top, objects };
}

function decode(
  response: string,
  schema: JsonSchemaLike,
): { decoded: DecodedResponse | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = normalizeEmptyCollections(JSON.parse(response));
  } catch (err) {
    return { decoded: null, errors: [`invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const validate = ajv.compile(schema);
  if (!validate(parsed)) {
    return {
      decoded: null,
      errors: (validate.errors ?? []).map((e: { instancePath: string; message?: string }) => `${e.instancePath || "/"} ${e.message}`),
    };
  }
  return { decoded: parsed as DecodedResponse, errors: [] };
}

function explain(decodeErrors: string[], violations: ConstraintViolation[]): string {
  return [...decodeErrors, ...violations.map((v) => v.message)].map((e) => `- ${e}`).join("\n");
}

/**
 * Lift (Algorithm 2, L0): decode r against Schema(MM_a), instantiate with
 * stable ids so trace links survive iterations (P2), check TypeErrors u
 * Phi_a, and let the agent repair up to k_L times. Returns null (bottom) if
 * no conforming model is reached within the retry budget.
 */
export async function lift(params: LiftParams): Promise<LiftResult | null> {
  const schema = deriveJsonSchema(params.metamodel);
  let response = params.response;

  for (let attempt = 1; attempt <= params.maxRetries; attempt++) {
    const { decoded, errors: decodeErrors } = decode(response, schema);
    const model = decoded ? instantiate(decoded, params.current) : params.current;
    const violations = decoded ? checkConstraints(model, params.metamodel) : [];

    if (decodeErrors.length === 0 && violations.length === 0) {
      return { model, diff: diffModels(params.current, model) };
    }

    response = await params.repair(response, explain(decodeErrors, violations));
  }
  return null;
}
