import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/engine-client";

const VARIANT: Record<RunStatus, "default" | "success" | "destructive" | "warning"> = {
  running: "default",
  succeeded: "success",
  failed: "destructive",
  budget_exhausted: "warning",
};

const LABEL: Record<RunStatus, string> = {
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  budget_exhausted: "budget exhausted",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge data-testid="run-status-badge" variant={VARIANT[status]} className="capitalize">
      {status === "running" ? (
        <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
      ) : null}
      {LABEL[status]}
    </Badge>
  );
}
