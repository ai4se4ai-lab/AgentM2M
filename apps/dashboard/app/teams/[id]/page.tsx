"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, PlayCircle, Sparkles } from "lucide-react";
import { getTeam, EngineError } from "@/lib/engine-client";
import { PageHeader } from "@/components/nav/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamGraphCanvas } from "@/components/team-graph/team-graph-canvas";

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: team, isLoading, error } = useQuery({
    queryKey: ["team", id],
    queryFn: () => getTeam(id),
  });

  return (
    <div>
      <PageHeader
        title={team ? team.name : "Team"}
        description={team ? `id: ${team.id}` : undefined}
        actions={
          <>
            <Link href="/teams">
              <Button variant="outline" size="sm">
                <ArrowLeft />
                All teams
              </Button>
            </Link>
            {team ? (
              <Link href={{ pathname: "/runs", query: { teamId: team.id } }}>
                <Button size="sm">
                  <PlayCircle />
                  Launch a run
                </Button>
              </Link>
            ) : null}
          </>
        }
      />
      <div className="space-y-6 p-8">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading team...
          </div>
        ) : error ? (
          <EmptyState
            icon={AlertTriangle}
            variant="error"
            title="Could not load this team"
            description={error instanceof EngineError ? error.message : "Unknown error."}
          />
        ) : !team ? null : (
          <>
            <TeamGraphCanvas team={team} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Agents ({team.agents.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {team.agents.map((agent) => (
                    <div
                      key={agent.id}
                      data-testid={`agent-row-${agent.id}`}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{agent.role}</span>
                          <span className="font-mono text-xs text-muted-foreground">{agent.id}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {agent.systemPrompt ?? "no system prompt"}
                        </p>
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-2">
                        <Badge variant={agent.modelBinding.provider === "ollama" ? "success" : "accent"}>
                          {agent.modelBinding.provider}
                        </Badge>
                        <Badge variant="outline" className="font-mono">
                          {agent.modelBinding.modelId}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Thresholds</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">theta</span>
                    <span className="font-mono">{team.thresholds.theta}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">A_max</span>
                    <span className="font-mono">{team.thresholds.aMax}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Edges ({team.edges.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-4">edge</th>
                        <th className="py-2 pr-4">source</th>
                        <th className="py-2 pr-4">omega</th>
                        <th className="py-2 pr-4">target</th>
                        <th className="py-2 pr-4">oracle</th>
                        <th className="py-2 pr-4">budgets (k/l)</th>
                        <th className="py-2 pr-4">checks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {team.edges.map((edge) => (
                        <tr key={edge.id} data-testid={`edge-row-${edge.id}`} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-4 font-mono">{edge.id}</td>
                          <td className="py-2 pr-4">{edge.source}</td>
                          <td className="py-2 pr-4 font-mono text-primary">{edge.omega}</td>
                          <td className="py-2 pr-4">{edge.target}</td>
                          <td className="py-2 pr-4">
                            <Badge variant="outline">{edge.oracle.kind}</Badge>
                          </td>
                          <td className="py-2 pr-4 font-mono">
                            {edge.budgets.k}/{edge.budgets.l}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {edge.structuralRule.checks.length}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {team.adaptationRules.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" /> Adaptation rules (Lambda)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {team.adaptationRules.map((rule) => (
                    <div key={rule.id} className="rounded-md border border-border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold">{rule.id}</span>
                        <Badge variant="secondary">{rule.action}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{rule.condition}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
