"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Pause, Radio } from "lucide-react";
import type { Team } from "@agentm2m/schema";
import type { TraceEvent } from "@/lib/engine-client";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/theme-provider";
import { AgentNode, type AgentNodeData } from "./agent-node";
import { AgentInspector } from "./agent-inspector";
import { EdgeInspector } from "./edge-inspector";
import { FloatingEdge, type FloatingEdgeData } from "./floating-edge";
import { applyAdaptations, deriveLiveState, usePlayedCount } from "./live-state";

const nodeTypes = { agent: AgentNode };
const edgeTypes = { floating: FloatingEdge };

const OMEGA_COLOR: Record<string, string> = {
  "->": "#0ea5e9", // sky — source -> target
  "<-": "#f59e0b", // amber — target -> source
  "<->": "#7c6ff0", // violet — bidirectional
};

const NODE_W = 240;
const NODE_H = 150;

/** Places agents on an ellipse, first agent at the top, in team order. */
function ringPosition(index: number, count: number) {
  const rx = Math.max(300, count * 90);
  const ry = Math.max(190, count * 50);
  const angle = (2 * Math.PI * index) / count - Math.PI / 2;
  return { x: rx * Math.cos(angle) - NODE_W / 2, y: ry * Math.sin(angle) - NODE_H / 2 };
}

/** Re-frames the graph in the space left of the inspector so the selected node never hides behind it. */
function FitToViewport({ inspectorOpen, agentCount }: { inspectorOpen: boolean; agentCount: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      fitView({
        padding: { top: "40px", bottom: "70px", left: "40px", right: inspectorOpen ? "390px" : "40px" },
        duration: 350,
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [inspectorOpen, agentCount, fitView]);
  return null;
}

type Selection = { kind: "agent" | "edge"; id: string } | null;

export interface TeamGraphCanvasProps {
  team: Team;
  /** When set, the canvas becomes a live view of a run's trace stream. */
  events?: TraceEvent[];
  /** Whether the run is still producing events (drives pacing + live badge). */
  running?: boolean;
  /** Set when the run ended in `failed`, so agents stuck mid-turn are marked instead of spinning forever. */
  failure?: { error?: string };
  className?: string;
}

export function TeamGraphCanvas({ team, events, running = false, failure, className }: TeamGraphCanvasProps) {
  const { resolvedTheme } = useTheme();
  const isLive = events !== undefined;
  const allEvents = useMemo(() => events ?? [], [events]);

  const played = usePlayedCount(allEvents.length, running);
  const playedEvents = useMemo(() => allEvents.slice(0, played), [allEvents, played]);

  const displayTeam = useMemo(() => {
    const applied = playedEvents
      .filter((e) => e.algorithm === "Adapt" && e.step === "applied" && typeof e.detail?.rule === "string")
      .map((e) => e.detail!.rule as string);
    return applied.length > 0 ? applyAdaptations(team, applied) : team;
  }, [team, playedEvents]);

  const caughtUp = played >= allEvents.length;
  const failed = !!failure;
  const failureError = failure?.error;
  const live = useMemo(
    () => (isLive ? deriveLiveState(displayTeam, playedEvents, caughtUp && failed ? { error: failureError } : undefined) : null),
    [isLive, displayTeam, playedEvents, caughtUp, failed, failureError],
  );

  const [selection, setSelection] = useState<Selection>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);

  // Keep dragged positions across data/team changes; place newly inserted agents next to a neighbour.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return displayTeam.agents.map((agent, i) => {
        const existing = byId.get(agent.id);
        let position = existing?.position;
        if (!position) {
          const neighbourId = displayTeam.edges
            .map((e) => (e.source === agent.id ? e.target : e.target === agent.id ? e.source : null))
            .find((id): id is string => !!id && byId.has(id));
          const neighbour = neighbourId ? byId.get(neighbourId) : undefined;
          position = neighbour
            ? { x: neighbour.position.x + NODE_W + 80, y: neighbour.position.y - 60 }
            : ringPosition(i, displayTeam.agents.length);
        }
        return {
          ...existing,
          id: agent.id,
          type: "agent",
          position,
          selected: selection?.kind === "agent" && selection.id === agent.id,
          data: {
            agent,
            live: live?.agents[agent.id],
            active: live?.activeAgentId === agent.id && !live.finished,
          },
        };
      });
    });
  }, [displayTeam, live, selection, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const pairCount = new Map<string, number>();
    const pairSeen = new Map<string, number>();
    const pairKey = (a: string, b: string) => [a, b].sort().join("|");
    for (const e of displayTeam.edges) {
      const k = pairKey(e.source, e.target);
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }
    return displayTeam.edges.map((edge) => {
      const color = OMEGA_COLOR[edge.omega] ?? "#94a3b8";
      const k = pairKey(edge.source, edge.target);
      const idx = pairSeen.get(k) ?? 0;
      pairSeen.set(k, idx + 1);
      const offset = (idx - ((pairCount.get(k) ?? 1) - 1) / 2) * 60;
      const edgeLive = live?.edges[edge.id];
      const active = !!live && !live.finished && live.activeEdgeId === edge.id;
      const marker = { type: MarkerType.ArrowClosed, color, width: 18, height: 18 };
      const data: FloatingEdgeData = {
        edge,
        color,
        offset,
        active,
        flow: edgeLive?.lastRestoreSide === "source" ? "backward" : "forward",
        restores: edgeLive?.restores,
        onSelect: (id) => setSelection({ kind: "edge", id }),
      };
      return {
        id: edge.id,
        type: "floating",
        source: edge.source,
        target: edge.target,
        selected: selection?.kind === "edge" && selection.id === edge.id,
        markerEnd: edge.omega === "<-" ? undefined : marker,
        markerStart: edge.omega === "->" ? undefined : marker,
        data,
      };
    });
  }, [displayTeam, live, selection]);

  const selectedAgent = selection?.kind === "agent" ? displayTeam.agents.find((a) => a.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === "edge" ? displayTeam.edges.find((e) => e.id === selection.id) : undefined;
  const hasInspector = !!selectedAgent || !!selectedEdge;

  return (
    <div
      className={cn(
        "relative h-[600px] w-full overflow-hidden rounded-xl border border-border bg-gradient-to-b from-background to-muted/30",
        className,
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        colorMode={resolvedTheme}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_, node) => setSelection({ kind: "agent", id: node.id })}
        onEdgeClick={(_, edge) => setSelection({ kind: "edge", id: edge.id })}
        onPaneClick={() => setSelection(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} className="opacity-50" />
        <FitToViewport inspectorOpen={hasInspector} agentCount={displayTeam.agents.length} />
        <Controls showInteractive={false} position="bottom-left" />
        {hasInspector ? null : <MiniMap pannable zoomable position="bottom-right" className="!bg-card" />}
      </ReactFlow>

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5 rounded-lg border border-border bg-card/90 px-3 py-2 text-[11px] shadow-sm backdrop-blur">
        <span className="font-semibold text-muted-foreground">ω · propagation rights</span>
        {(
          [
            ["->", "source → target"],
            ["<-", "target → source"],
            ["<->", "both directions"],
          ] as const
        ).map(([omega, text]) => (
          <div key={omega} className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: OMEGA_COLOR[omega] }} />
            <span className="w-7 font-mono font-semibold">{omega}</span>
            <span className="text-muted-foreground">{text}</span>
          </div>
        ))}
        {!isLive ? <span className="mt-0.5 text-muted-foreground">Click an agent or edge for details</span> : null}
      </div>

      {live ? <LiveTicker live={live} running={running} total={allEvents.length} played={played} shifted={hasInspector} /> : null}

      {selectedAgent ? (
        <AgentInspector
          key={selectedAgent.id}
          agent={selectedAgent}
          team={displayTeam}
          live={live?.agents[selectedAgent.id]}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selectedEdge ? (
        <EdgeInspector
          key={selectedEdge.id}
          edge={selectedEdge}
          live={live?.edges[selectedEdge.id]}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </div>
  );
}

function LiveTicker({
  live,
  running,
  total,
  played,
  shifted,
}: {
  live: NonNullable<ReturnType<typeof deriveLiveState>>;
  running: boolean;
  total: number;
  played: number;
  /** Inspector panel is open on the right; centre within the remaining space. */
  shifted: boolean;
}) {
  const busy = running || played < total;
  const workingAgent = Object.entries(live.agents).find(([, a]) => a.status === "working");
  return (
    <div
      data-testid="live-ticker"
      style={{ left: shifted ? "calc((100% - 372px) / 2)" : "50%" }}
      className="pointer-events-none absolute bottom-3 flex max-w-[min(36rem,calc(100%-9rem))] -translate-x-1/2 items-center gap-2.5 rounded-full border border-border bg-card/95 py-1.5 pl-3 pr-4 text-xs shadow-lg backdrop-blur"
    >
      {busy ? (
        <span className="flex shrink-0 items-center gap-1 font-semibold text-success">
          <Radio className="h-3.5 w-3.5 animate-pulse-dot" /> LIVE
        </span>
      ) : (
        <span className={cn("flex shrink-0 items-center gap-1 font-semibold", live.crashed ? "text-destructive" : "text-muted-foreground")}>
          <Pause className="h-3.5 w-3.5" /> {live.crashed ? "FAILED" : live.finished ? (live.accepted ? "ACCEPTED" : "FINISHED") : "IDLE"}
        </span>
      )}
      <span className="min-w-0 truncate">
        {live.crashed ? (
          <span className="text-destructive">Run failed: {live.crashed}</span>
        ) : live.focus ? (
          live.focus.summary
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Waiting for the first event…
          </span>
        )}
      </span>
      {workingAgent && busy ? (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
          {workingAgent[0]} thinking…
        </span>
      ) : null}
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {played}/{total}
      </span>
    </div>
  );
}
