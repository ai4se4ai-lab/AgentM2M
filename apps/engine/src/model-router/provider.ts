import type { ModelBinding } from "@agentm2m/schema";

export interface GenerateOptions {
  system?: string;
  json?: boolean;
}

export interface ModelProviderClient {
  generate(binding: ModelBinding, prompt: string, options?: GenerateOptions): Promise<string>;
}

export interface UsageRecord {
  provider: string;
  modelId: string;
  promptChars: number;
  responseChars: number;
  ts: string;
}

export type UsageSink = (record: UsageRecord) => void;
