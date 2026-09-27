"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PlayCircle } from "lucide-react";
import { listRuns, EngineError } from "@/lib/engine-client";
import { PageHeader } from "@/components/nav/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunLauncherForm } from "@/components/runs/run-launcher-form";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { formatDate } from "@/lib/utils";

export default function RunsPage() {
  return (
    <div>
      <PageHeader
        title="Runs"
        description="Launch RunTeam against a live team and watch the Lift / GuardedRestore / Propagate / Adapt trace stream in."
      />
      <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-[420px_1fr]">
        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading form...</div>}>
          <LauncherWithPrefill />
        </Suspense>
        <RunsList />
      </div>
    </div>
  );
}

function LauncherWithPrefill() {
  const params = useSearchParams();
  const teamId = params.get("teamId") ?? undefined;
  return <RunLauncherForm defaultTeamId={teamId} />;
}

function RunsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["runs"],
    queryFn: listRuns,
    refetchInterval: 4000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent runs</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading runs...
          </div>
        ) : error ? (
          <EmptyState
            icon={AlertTriangle}
            variant="error"
            title="Could not load runs"
            description={error instanceof EngineError ? error.message : "Unknown error."}
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={PlayCircle}
            title="No runs yet"
            description="Launch one from the form on the left — it calls the real engine and the real local Ollama model."
          />
        ) : (
          <div className="space-y-2">
            {[...data]
              .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
              .map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-muted-foreground">{run.id}</span>
                    <span className="font-medium">{run.teamId}</span>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</span>
                    <RunStatusBadge status={run.status} />
                  </div>
                </Link>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
