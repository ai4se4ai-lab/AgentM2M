import type { ModelBinding } from "@agentm2m/schema";
import type { GenerateOptions, ModelProviderClient, UsageSink } from "./provider.js";

interface OllamaGenerateResponse {
  response: string;
}

interface OllamaTagsResponse {
  models: { name: string; size?: number; details?: { parameter_size?: string; quantization_level?: string } }[];
}

export class OllamaProvider implements ModelProviderClient {
  constructor(private readonly onUsage?: UsageSink) {}

  async generate(binding: ModelBinding, prompt: string, options: GenerateOptions = {}): Promise<string> {
    const host = binding.ollamaHost ?? process.env.OLLAMA_DEFAULT_HOST ?? "http://localhost:11434";
    const res = await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: binding.modelId,
        prompt,
        system: options.system,
        stream: false,
        format: options.json ? "json" : undefined,
        options: { temperature: binding.temperature ?? 0.2, num_predict: binding.maxTokens ?? 2048 },
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama generate failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as OllamaGenerateResponse;
    this.onUsage?.({
      provider: "ollama",
      modelId: binding.modelId,
      promptChars: prompt.length,
      responseChars: body.response.length,
      ts: new Date().toISOString(),
    });
    return body.response;
  }

  static async testConnection(host: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const res = await fetch(`${host}/api/tags`, { method: "GET" });
      if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
      const body = (await res.json()) as OllamaTagsResponse;
      return { ok: true, models: body.models.map((m) => m.name) };
    } catch (err) {
      return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  static async listModels(host: string): Promise<OllamaTagsResponse["models"]> {
    const res = await fetch(`${host}/api/tags`, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as OllamaTagsResponse;
    return body.models;
  }
}
