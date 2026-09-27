import type { ModelBinding, ModelProvider } from "@agentm2m/schema";
import type { GenerateOptions, ModelProviderClient } from "./provider.js";

/**
 * ModelBinding -> generate(prompt) -> text, per docs/dev.md §7. Cloud
 * providers (openai/anthropic/google/openrouter) are wired the same way but
 * are not implemented in this prototype pass — this sandbox has no cloud API
 * keys, so the faithful-core-slice targets the free, local Ollama path plus
 * the mock provider for deterministic tests. Adding a cloud provider is a
 * matter of implementing ModelProviderClient and registering it here.
 */
export class ModelRouter {
  private readonly providers = new Map<ModelProvider, ModelProviderClient>();

  register(provider: ModelProvider, client: ModelProviderClient): this {
    this.providers.set(provider, client);
    return this;
  }

  async generate(binding: ModelBinding, prompt: string, options?: GenerateOptions): Promise<string> {
    const client = this.providers.get(binding.provider);
    if (!client) throw new Error(`ModelRouter: no provider registered for '${binding.provider}'`);
    return client.generate(binding, prompt, options);
  }
}
