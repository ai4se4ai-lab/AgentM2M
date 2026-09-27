"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Users, AlertTriangle, ArrowRight } from "lucide-react";
import { listTeams, EngineError } from "@/lib/engine-client";
import { PageHeader } from "@/components/nav/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";

export default function TeamsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["teams"],
    queryFn: listTeams,
  });

  return (
    <div>
      <PageHeader
        title="Teams"
        description="L1 collaboration structures: agents, edges, and propagation rights (omega) that make up each running team."
      />
      <div className="p-8">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading teams from the engine...
          </div>
        ) : error ? (
          <EmptyState
            icon={AlertTriangle}
            variant="error"
            title="Could not reach the engine"
            description={
              error instanceof EngineError
                ? error.message
                : "Unknown error contacting the orchestration engine."
            }
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No teams yet"
            description="Create a team via POST /api/teams, or check that the engine's seed data loaded."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((team) => (
              <Link key={team.id} href={`/teams/${team.id}`} data-testid={`team-card-${team.id}`}>
                <Card className="h-full transition-colors hover:border-primary/50 hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{team.name}</CardTitle>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <CardDescription className="font-mono text-xs">{team.id}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="secondary">team</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
