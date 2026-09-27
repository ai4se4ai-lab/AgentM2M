import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Bot, CheckCircle2, Cloud, HardDrive, Loader2, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentDef } from "@agentm2m/schema";
import type { AgentLive, AgentStatus } from "./live-state";

export interface AgentNodeData {
  agent: AgentDef;
  /** Present only when the canvas is bound to a run's event stream. */
  live?: AgentLive;
  /** True while the latest event is about this agent. */
  active?: boolean;
  [key: string]: unknown;
}

export const STATUS_META: Record<AgentStatus, { label: string; tone: string; dot: string; icon: typeof Bot }> = {
  idle: { label: "Idle", tone: "text-muted-foreground", dot: "bg-muted-foreground/50", icon: Bot },
  working: { label: "Thinking", tone: "text-primary", dot: "bg-primary", icon: Loader2 },
  lifted: { label: "Model updated", tone: "text-success", dot: "bg-success", icon: CheckCircle2 },
  restored: { label: "Restored", tone: "text-accent", dot: "bg-accent", icon: RefreshCcw },
  failed: { label: "Lift failed", tone: "text-destructive", dot: "bg-destructive", icon: AlertTriangle },
};

// Handles are invisible: edges attach to the node's border (see floating-edge.tsx),
// but React Flow still needs one source and one target handle to register the node.
const hiddenHandle = "!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

function AgentNodeImpl({ data, selected }: NodeProps) {
  const { agent, live, active } = data as unknown as AgentNodeData;
  const isLocal = agent.modelBinding.provider === "ollama";
  const status = live?.status ?? "idle";
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const isWorking = status === "working" && active;

  return (
    <div
      data-testid={`agent-node-${agent.id}`}
      data-status={live ? status : undefined}
      className={cn(
        "relative w-60 rounded-xl border bg-card shadow-sm transition-all duration-300",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border",
        live && active && status === "failed" && "border-destructive ring-2 ring-destructive/30",
        live && active && status !== "failed" && "border-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.15),0_8px_24px_-8px_hsl(var(--primary)/0.5)]",
      )}
    >
      {isWorking ? (
        <span className="pointer-events-none absolute -inset-1 animate-ping rounded-2xl border border-primary/40" />
      ) : null}
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <Handle type="source" position={Position.Bottom} className={hiddenHandle} />

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-[18px] w-[18px]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-semibold">{agent.role}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">{agent.id}</span>
        </div>
        {live ? (
          <span
            title={meta.label}
            className={cn("flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium", meta.tone)}
          >
            <StatusIcon className={cn("h-3 w-3", isWorking && "animate-spin")} />
            {meta.label}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border/70 px-3 py-1.5">
        {isLocal ? <HardDrive className="h-3 w-3 text-success" /> : <Cloud className="h-3 w-3 text-accent" />}
        <span className="truncate font-mono text-[11px] text-muted-foreground">{agent.modelBinding.modelId}</span>
      </div>

      <div className="flex flex-wrap gap-1 px-3 pb-2.5 pt-1">
        {agent.metamodel.classes.slice(0, 3).map((c) => (
          <span
            key={c.name}
            className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
          >
            {c.name}
          </span>
        ))}
        {agent.metamodel.classes.length > 3 ? (
          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
            +{agent.metamodel.classes.length - 3}
          </span>
        ) : null}
      </div>

      {live ? (
        <div className="grid grid-cols-3 divide-x divide-border/70 border-t border-border/70 text-center">
          <Stat label="turns" value={live.turns} />
          <Stat label="objects" value={live.objects.length} />
          <Stat label="restores" value={live.restores} />
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-1.5 leading-tight">
      <div className="text-xs font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

export const AgentNode = memo(AgentNodeImpl);
