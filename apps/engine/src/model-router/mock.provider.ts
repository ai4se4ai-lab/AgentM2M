import type { ModelBinding } from "@agentm2m/schema";
import type { GenerateOptions, ModelProviderClient } from "./provider.js";

/**
 * Deterministic, scripted provider for unit tests (Section 13's "mocked
 * ModelRouter returning scripted LLM outputs"). Responses are queued per
 * agent role and consumed in order; a role with an exhausted queue throws so
 * tests fail loudly instead of silently returning `undefined`.
 */
export class MockProvider implements ModelProviderClient {
  private readonly queues = new Map<string, string[]>();
  public readonly calls: { role: string; prompt: string }[] = [];

  script(role: string, responses: string[]): this {
    this.queues.set(role, [...responses]);
    return this;
  }

  async generate(binding: ModelBinding, prompt: string, _options: GenerateOptions = {}): Promise<string> {
    this.calls.push({ role: binding.modelId, prompt });
    const queue = this.queues.get(binding.modelId);
    if (!queue || queue.length === 0) {
      throw new Error(`MockProvider: no scripted response left for '${binding.modelId}'`);
    }
    return queue.shift()!;
  }
}
