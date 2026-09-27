import { PlugZap } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { benchUrl, BenchUnavailableError } from "@/lib/bench-client";

export function BenchUnavailable({ error }: { error: unknown }) {
  const detail =
    error instanceof BenchUnavailableError
      ? error.reason === "unreachable"
        ? `No response from ${benchUrl()}. The bench service (apps/bench) is not running in this environment.`
        : error.detail
          ? `The bench service rejected the request (HTTP ${error.status}): ${error.detail}`
          : `The bench service responded with an error (HTTP ${error.status}). Its API may not implement this endpoint yet.`
      : "Unknown error contacting the bench service.";

  return (
    <EmptyState
      icon={PlugZap}
      variant="error"
      title={error instanceof BenchUnavailableError && error.reason === "http_error" ? "Bench request failed" : "Bench service unavailable"}
      description={detail}
    />
  );
}
