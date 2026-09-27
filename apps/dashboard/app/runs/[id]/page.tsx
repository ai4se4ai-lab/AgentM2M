"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Radio, WifiOff } from "lucide-react";
import { getRun, getTeam, EngineError } from "@/lib/engine-client";
import { useRunEvents } from "@/lib/use-run-events";
import { PageHeader } from "@/components/nav/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { RunTraceTimeline, AlgorithmLegend } from "@/components/run-trace/run-trace-timeline";
import { TeamGraphCanvas } from "@/components/team-graph/team-graph-canvas";
import { cn } from "@/lib/utils";

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });

  const { events, connectionState } = useRunEvents(runId);

  const teamId = runQuery.data?.teamId;
  const teamQuery = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => getTeam(teamId!),
    enabled: !!teamId,
  });
  // Prefer the run's final team: Adapt may have inserted agents the stored team doesn't have.
  const graphTeam = runQuery.data?.result?.team ?? teamQuery.data;

  return (
    <div>
      <PageHeader
        title="Run"
        description={runId}
        actions={
          <Link href="/runs">
            <Button variant="outline" size="sm">
              <ArrowLeft /> All runs
            </Button>
          </Link>
        }
      />
      <div className="space-y-6 p-8">
        {runQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading run...
          </div>
        ) : runQuery.error ? (
          <EmptyState
            icon={AlertTriangle}
            variant="error"
            title="Could not load this run"
            description={runQuery.error instanceof EngineError ? runQuery.error.message : "Unknown error."}
          />
        ) : !runQuery.data ? null : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Task</CardTitle>
                    <RunStatusBadge status={runQuery.data.status} />
                  </div>
                  <CardDescription>
                    team{" "}
                    <Link href={`/teams/${runQuery.data.teamId}`} className="font-mono text-primary hover:underline">
                      {runQuery.data.teamId}
                    </Link>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm text-foreground/90">{runQuery.data.task}</p>
                  {runQuery.data.error ? (
                    <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {runQuery.data.error}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {connectionState === "open" ? (
                      <Radio className="h-4 w-4 text-success" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    Live stream
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">WS state</span>
                    <span
                      className={cn(
                        "font-mono text-xs",
                        connectionState === "open" && "text-success",
                        connectionState === "error" && "text-destructive",
                      )}
                    >
                      {connectionState}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">events received</span>
                    <span className="font-mono text-xs tabular-nums">{events.length}</span>
                  </div>
                  {runQuery.data.result ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">iterations</span>
                        <span className="font-mono text-xs tabular-nums">{runQuery.data.result.iterations}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">cost</span>
                        <span className="font-mono text-xs tabular-nums">{runQuery.data.result.cost}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">accepted</span>
                        <Badge variant={runQuery.data.result.accepted ? "success" : "warning"}>
                          {String(runQuery.data.result.accepted)}
                        </Badge>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            {graphTeam ? (
              <Card>
                <CardHeader>
                  <CardTitle>Live team graph</CardTitle>
                  <CardDescription>
                    Agents light up as they are scheduled, edges pulse when they propagate. Click an agent or edge for its
                    metamodel, model objects and activity log.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TeamGraphCanvas
                    team={graphTeam}
                    events={events}
                    running={runQuery.data.status === "running"}
                    failure={runQuery.data.status === "failed" ? { error: runQuery.data.error } : undefined}
                  />
                </CardContent>
              </Card>
            ) : null}

            {runQuery.data.result && runQuery.data.result.escalations.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Escalations</CardTitle>
                  <CardDescription>Edges whose oracle never accepted within budget.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {runQuery.data.result.escalations.map((esc, i) => (
                    <div key={i} className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
                      <span className="font-mono font-semibold text-warning">{esc.edgeId}</span>
                      <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                        {esc.diagnostics.map((d, j) => (
                          <li key={j}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {runQuery.data.result ? (
              <Card>
                <CardHeader>
                  <CardTitle>Final artifact</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/70 p-3 text-xs leading-relaxed">
                    {runQuery.data.result.artifact}
                  </pre>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Trace timeline</CardTitle>
                  <AlgorithmLegend />
                </div>
                <CardDescription>
                  Grouped by algorithm (RunTeam / Lift / GuardedRestore / Propagate / Adapt); click a row with a
                  chevron to expand its JSON detail.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RunTraceTimeline events={events} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
