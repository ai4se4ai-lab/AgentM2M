import { X } from "lucide-react";
import type { EdgeDef } from "@agentm2m/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EdgeLive } from "./live-state";
import { ActivityList } from "./agent-inspector";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function EdgeInspector({ edge, live, onClose }: { edge: EdgeDef; live?: EdgeLive; onClose: () => void }) {
  return (
    <aside
      data-testid="edge-inspector"
      className="absolute inset-y-3 right-3 z-10 flex w-[360px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur"
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-mono text-sm font-semibold">{edge.id}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {edge.source} <span className="font-bold text-primary">{edge.omega}</span> {edge.target}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {live ? (
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md border border-border bg-muted/30 py-1.5">
              <div className="text-sm font-semibold tabular-nums">{live.restores}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">restorations</div>
            </div>
            <div className="rounded-md border border-border bg-muted/30 py-1.5">
              <div className="text-sm font-semibold tabular-nums">{live.changedRestores}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">changed a model</div>
            </div>
          </div>
        ) : null}

        <div>
          <SectionTitle>Oracle O_e</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{edge.oracle.kind}</Badge>
            {edge.oracle.executable ? (
              <code className="truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">{edge.oracle.executable.command}</code>
            ) : null}
          </div>
        </div>

        <div>
          <SectionTitle>Budgets (k / l)</SectionTitle>
          <p className="font-mono text-xs">
            k={edge.budgets.k} l={edge.budgets.l}
          </p>
        </div>

        <div>
          <SectionTitle>Structural checks (R_e^str)</SectionTitle>
          <ul className="space-y-1">
            {edge.structuralRule.checks.length === 0 ? (
              <li className="text-xs text-muted-foreground">none</li>
            ) : (
              edge.structuralRule.checks.map((check, i) => (
                <li key={i} className="rounded border border-border bg-muted/40 px-2 py-1 text-[11px]">
                  {check.kind === "coverage" ? (
                    <span>
                      every <code>{check.ofClass}</code> ({check.ofSide}) needs {"≥"}
                      {check.min} <code>{check.byClass}</code> via <code>{check.viaReference}</code>
                      {check.skeleton ? " · auto-skeleton" : ""}
                    </span>
                  ) : (
                    <span>
                      <code>{check.ofClass}</code> ({check.ofSide}).<code>{check.reference}</code> must resolve to{" "}
                      <code>{check.targetClass}</code>
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>

        {live ? (
          <div>
            <SectionTitle>Activity</SectionTitle>
            <ActivityList entries={live.activity} empty="This edge hasn't propagated anything yet." />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
