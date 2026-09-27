"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { getHypotheses } from "@/lib/bench-client";
import { PageHeader } from "@/components/nav/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { BenchUnavailable } from "@/components/bench/bench-unavailable";
import { HypothesisCard } from "@/components/evaluation/hypothesis-card";
import { RqPanel } from "@/components/evaluation/rq-panel";

const RQS = [
  { id: "rq1", title: "RQ1 — Effectiveness", description: "AgentM2M(DevTeam) vs. SWE-agent / OpenHands / Agentless / MAGIS across Lite/Verified/Live/Pro." },
  { id: "rq2", title: "RQ2 — Collaboration quality", description: "MAST-taxonomy LLM-judge scoring of rendered handoffs, message-passing vs. view-model systems." },
  { id: "rq3", title: "RQ3 — Ablations", description: "--no-guards / --llm-only-restorers / --forward-only / --no-lift-repair / --fixed-team variants." },
  { id: "rq4", title: "RQ4 — Adaptation", description: "Backend-swap, requirement-drift, multi-file, and agent-fault scenario injectors." },
  { id: "rq5", title: "RQ5 — Fidelity / oracle error", description: "Lift fidelity, oracle error rate, and propagation order sensitivity." },
  { id: "rq6", title: "RQ6 — Cost & scalability", description: "Budget sweep and team-size sweep with per-step cost accounting." },
];

export default function EvaluationPage() {
  const hypothesesQuery = useQuery({ queryKey: ["hypotheses"], queryFn: getHypotheses, retry: 0 });

  return (
    <div>
      <PageHeader
        title="Evaluation"
        description="RQ1-RQ6 reproductions and H1-H7 hypothesis status, served by the bench service's evaluation API."
      />
      <div className="space-y-8 p-8">
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="h-4 w-4" /> Hypotheses (H1-H7)
          </h2>
          {hypothesesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading hypothesis table...
            </div>
          ) : hypothesesQuery.error ? (
            <BenchUnavailable error={hypothesesQuery.error} />
          ) : !hypothesesQuery.data || hypothesesQuery.data.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No hypotheses reported yet" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hypothesesQuery.data.map((h) => (
                <HypothesisCard key={h.id} h={h} />
              ))}
            </div>
          )}
        </section>

        <section>
          <Tabs defaultValue="rq1">
            <TabsList>
              {RQS.map((rq) => (
                <TabsTrigger key={rq.id} value={rq.id}>
                  {rq.id.toUpperCase()}
                </TabsTrigger>
              ))}
            </TabsList>
            {RQS.map((rq) => (
              <TabsContent key={rq.id} value={rq.id}>
                <RqPanel rq={rq.id} title={rq.title} description={rq.description} />
              </TabsContent>
            ))}
          </Tabs>
        </section>
      </div>
    </div>
  );
}
