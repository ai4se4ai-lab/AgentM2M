"use client";

import { useState } from "react";
import { Bot, Cloud, HardDrive, X } from "lucide-react";
import type { AgentDef, ModelObject, Team } from "@agentm2m/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { AgentLive, ActivityEntry } from "./live-state";
import { STATUS_META } from "./agent-node";

const ALGO_COLOR: Record<string, string> = {
  RunTeam: "#7c6ff0",
  Lift: "#0ea5e9",
  GuardedRestore: "#f59e0b",
  Propagate: "#10b981",
  Adapt: "#ec4899",
};

export function ActivityList({ entries, empty }: { entries: ActivityEntry[]; empty: string }) {
  if (entries.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {[...entries].reverse().map((entry) => {
        const color = ALGO_COLOR[entry.event.algorithm] ?? "#94a3b8";
        return (
          <li key={entry.index} className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[10px]">
              <span
                className="rounded-full px-1.5 py-px font-semibold uppercase tracking-wide"
                style={{ backgroundColor: `${color}22`, color }}
              >
                {entry.event.algorithm}
              </span>
              <span className="font-mono text-muted-foreground">{entry.event.step}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">#{entry.index}</span>
            </div>
            <p className="mt-1 text-xs leading-snug">{entry.summary}</p>
          </li>
        );
      })}
    </ul>
  );
}

function ObjectCard({ obj }: { obj: ModelObject }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{obj.className}</span>
        <code className="truncate text-[10px] text-muted-foreground">{obj.id.slice(0, 10)}</code>
      </div>
      <dl className="mt-1 space-y-0.5">
        {Object.entries(obj.attributes).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="shrink-0 font-mono text-[11px] text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words text-[11px]">{String(v)}</dd>
          </div>
        ))}
        {Object.entries(obj.references).map(([k, ids]) => (
          <div key={k} className="flex gap-2">
            <dt className="shrink-0 font-mono text-[11px] text-primary">→ {k}</dt>
            <dd className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
              {ids.map((i) => i.slice(0, 8)).join(", ") || "∅"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function AgentInspector({
  agent,
  team,
  live,
  onClose,
}: {
  agent: AgentDef;
  team: Team;
  live?: AgentLive;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const isLocal = agent.modelBinding.provider === "ollama";
  const meta = live ? STATUS_META[live.status] : undefined;
  const incident = team.edges.filter((e) => e.source === agent.id || e.target === agent.id);

  return (
    <aside
      data-testid="agent-inspector"
      className="absolute inset-y-3 right-3 z-10 flex w-[360px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur"
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{agent.role}</h3>
            {meta ? <span className={cn("text-[11px] font-medium", meta.tone)}>● {meta.label}</span> : null}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{agent.id}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 grid h-auto grid-cols-4 gap-0.5 [&>button]:px-1 [&>button]:text-xs">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="metamodel">Metamodel</TabsTrigger>
          <TabsTrigger value="model" disabled={!live}>
            Model{live ? ` (${live.objects.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="activity" disabled={!live}>
            Log
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          <TabsContent value="overview" className="mt-0 space-y-4">
            <div>
              <SectionTitle>Model binding</SectionTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={isLocal ? "success" : "accent"}>
                  {isLocal ? <HardDrive className="mr-1 h-3 w-3" /> : <Cloud className="mr-1 h-3 w-3" />}
                  {agent.modelBinding.provider}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {agent.modelBinding.modelId}
                </Badge>
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                temperature {agent.modelBinding.temperature} · max tokens {agent.modelBinding.maxTokens}
              </p>
            </div>

            {live ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  ["turns", live.turns],
                  ["lift ok", live.liftOk],
                  ["lift fail", live.liftFail],
                  ["restores", live.restores],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border bg-muted/30 py-1.5">
                    <div className="text-sm font-semibold tabular-nums">{value}</div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <SectionTitle>System prompt</SectionTitle>
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs leading-relaxed">
                {agent.systemPrompt ?? "No system prompt."}
              </p>
            </div>

            <div>
              <SectionTitle>Connected edges ({incident.length})</SectionTitle>
              <ul className="space-y-1">
                {incident.map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs">
                    <span className="font-mono">
                      <span className="font-semibold">{e.id}</span> · {e.source} {e.omega} {e.target}
                    </span>
                    <Badge variant="outline">{e.oracle.kind}</Badge>
                  </li>
                ))}
                {incident.length === 0 ? <li className="text-xs text-muted-foreground">none</li> : null}
              </ul>
            </div>

            {agent.tools.length > 0 ? (
              <div>
                <SectionTitle>Tools</SectionTitle>
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((t) => (
                    <Badge key={t} variant="secondary" className="font-mono">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="metamodel" className="mt-0 space-y-3">
            {agent.metamodel.classes.map((c) => (
              <div key={c.name} className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2.5 py-1.5">
                  <span className="text-xs font-semibold">{c.name}</span>
                  {c.concept ? <Badge variant="secondary">{c.concept}</Badge> : null}
                </div>
                <ul className="divide-y divide-border/60 text-[11px]">
                  {c.attributes.map((a) => (
                    <li key={a.name} className="flex items-center justify-between px-2.5 py-1">
                      <span className="font-mono">
                        {a.name}
                        {a.required ? <span className="text-destructive">*</span> : null}
                      </span>
                      <span className="text-muted-foreground">{a.type}</span>
                    </li>
                  ))}
                  {c.references.map((r) => (
                    <li key={r.name} className="flex items-center justify-between px-2.5 py-1">
                      <span className="font-mono text-primary">→ {r.name}</span>
                      <span className="text-muted-foreground">
                        {r.target} [{r.multiplicity}]
                      </span>
                    </li>
                  ))}
                  {c.attributes.length + c.references.length === 0 ? (
                    <li className="px-2.5 py-1 text-muted-foreground">no fields</li>
                  ) : null}
                </ul>
              </div>
            ))}
            {agent.metamodel.constraints.length > 0 ? (
              <div>
                <SectionTitle>Constraints (Φ)</SectionTitle>
                <ul className="space-y-1">
                  {agent.metamodel.constraints.map((k, i) => (
                    <li key={i} className="rounded-md border border-border bg-muted/30 px-2.5 py-1 font-mono text-[11px]">
                      {k.kind} · {k.class}
                      {"attribute" in k ? `.${k.attribute}` : ""}
                      {"reference" in k ? `.${k.reference}` : ""}
                      {"min" in k ? ` ≥ ${k.min}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="model" className="mt-0 space-y-2">
            {live && live.objects.length > 0 ? (
              live.objects.map((o) => <ObjectCard key={o.id} obj={o} />)
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No objects in this agent's model yet.
              </p>
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            <ActivityList entries={live?.activity ?? []} empty="No activity for this agent yet." />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
