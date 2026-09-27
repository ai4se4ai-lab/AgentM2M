"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TraceEvent } from "@/lib/engine-client";

const ALGO_COLOR: Record<TraceEvent["algorithm"], string> = {
  RunTeam: "#7c6ff0",
  Lift: "#0ea5e9",
  GuardedRestore: "#f59e0b",
  Propagate: "#10b981",
  Adapt: "#ec4899",
};

export function RunTraceTimeline({ events }: { events: TraceEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No trace events yet. Waiting on the engine...
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute bottom-0 left-[15px] top-0 w-px bg-border" />
      <ul className="space-y-1">
        {events.map((evt, i) => (
          <TraceEventRow key={i} evt={evt} index={i} />
        ))}
      </ul>
    </div>
  );
}

function TraceEventRow({ evt, index }: { evt: TraceEvent; index: number }) {
  const [open, setOpen] = useState(false);
  const color = ALGO_COLOR[evt.algorithm] ?? "#94a3b8";
  const hasDetail = evt.detail && Object.keys(evt.detail).length > 0;

  return (
    <li data-testid="trace-event-row" className="relative pl-9">
      <span
        className="absolute left-[10px] top-2.5 h-3 w-3 rounded-full border-2 border-background"
        style={{ backgroundColor: color }}
      />
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          hasDetail ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
        )}
      >
        {hasDetail ? (
          <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        ) : (
          <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: `${color}22`, color }}
        >
          {evt.algorithm}
        </span>
        <span className="flex-1 truncate font-mono text-xs text-foreground/90">{evt.step}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {evt.agentId ? <code className="rounded bg-muted px-1">{evt.agentId}</code> : null}
          {evt.edgeId ? <code className="rounded bg-muted px-1">{evt.edgeId}</code> : null}
          {typeof evt.seq === "number" ? <span className="tabular-nums">#{evt.seq}</span> : <span className="tabular-nums">#{index}</span>}
        </span>
      </button>
      {open && hasDetail ? (
        <pre className="mb-1.5 ml-9 max-h-64 overflow-auto rounded-md bg-muted/70 p-3 text-[11px] leading-relaxed">
          {JSON.stringify(evt.detail, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

export function AlgorithmLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {Object.entries(ALGO_COLOR).map(([algo, color]) => (
        <div key={algo} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {algo}
        </div>
      ))}
    </div>
  );
}
