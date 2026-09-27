import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { EdgeDef } from "@agentm2m/schema";

export interface FloatingEdgeData {
  edge: EdgeDef;
  color: string;
  /** Perpendicular offset (px) so parallel edges between the same pair don't overlap. */
  offset: number;
  /** Set while the latest trace event is a Propagate on this edge. */
  active?: boolean;
  /** Direction the restoration travelled: from the untouched side towards the restored side. */
  flow?: "forward" | "backward";
  restores?: number;
  onSelect?: (edgeId: string) => void;
  [key: string]: unknown;
}

interface Point {
  x: number;
  y: number;
}

function nodeRect(node: InternalNode) {
  const w = node.measured.width ?? 240;
  const h = node.measured.height ?? 120;
  const { x, y } = node.internals.positionAbsolute;
  return { cx: x + w / 2, cy: y + h / 2, w, h };
}

/** Point where the line from the node's centre towards `toward` leaves its rectangle, pushed out by `gap`. */
function borderPoint(node: InternalNode, toward: Point, gap = 6): Point {
  const { cx, cy, w, h } = nodeRect(node);
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(w / 2 / Math.abs(dx || 1e-6), h / 2 / Math.abs(dy || 1e-6));
  const len = Math.hypot(dx, dy);
  return { x: cx + dx * scale + (dx / len) * gap, y: cy + dy * scale + (dy / len) * gap };
}

function FloatingEdgeImpl({ id, source, target, markerStart, markerEnd, data, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const { edge, color, offset, active, flow, restores = 0, onSelect } = data as unknown as FloatingEdgeData;

  const s = nodeRect(sourceNode);
  const t = nodeRect(targetNode);
  const mid = { x: (s.cx + t.cx) / 2, y: (s.cy + t.cy) / 2 };
  const len = Math.hypot(t.cx - s.cx, t.cy - s.cy) || 1;
  // Unit normal to the centre-to-centre line.
  const nx = -(t.cy - s.cy) / len;
  const ny = (t.cx - s.cx) / len;
  const control = { x: mid.x + nx * offset * 2, y: mid.y + ny * offset * 2 };

  // Aim each end at the curve's control point so the curve leaves the border cleanly.
  const aim = offset === 0 ? undefined : control;
  const p1 = borderPoint(sourceNode, aim ?? { x: t.cx, y: t.cy });
  const p2 = borderPoint(targetNode, aim ?? { x: s.cx, y: s.cy });

  const path =
    offset === 0
      ? `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`
      : `M ${p1.x} ${p1.y} Q ${control.x} ${control.y} ${p2.x} ${p2.y}`;
  const label =
    offset === 0
      ? { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      : { x: 0.25 * p1.x + 0.5 * control.x + 0.25 * p2.x, y: 0.25 * p1.y + 0.5 * control.y + 0.25 * p2.y };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={24}
        className={active ? (flow === "backward" ? "edge-flow edge-flow-back" : "edge-flow") : undefined}
        style={{
          stroke: color,
          strokeWidth: active || selected ? 3 : 1.75,
          strokeDasharray: active ? "7 5" : undefined,
          opacity: active || selected ? 1 : 0.75,
          filter: active ? `drop-shadow(0 0 5px ${color})` : undefined,
          transition: "stroke-width 200ms, opacity 200ms",
        }}
      />
      {active ? (
        <circle r={5} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
          <animateMotion
            dur="1.1s"
            repeatCount="indefinite"
            path={path}
            {...(flow === "backward" ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" } : {})}
          />
        </circle>
      ) : null}
      <EdgeLabelRenderer>
        <button
          type="button"
          data-testid={`edge-label-${edge.id}`}
          onClick={() => onSelect?.(edge.id)}
          style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, borderColor: color }}
          className={cn(
            "nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[10px] shadow-sm transition-all",
            "hover:shadow-md",
            (active || selected) && "scale-110 shadow-md",
          )}
        >
          <span className="font-semibold text-foreground">{edge.id}</span>
          <span className="font-mono font-bold" style={{ color }}>
            {edge.omega}
          </span>
          {restores > 0 ? (
            <span className="rounded-full px-1 font-semibold tabular-nums text-white" style={{ backgroundColor: color }}>
              {restores}
            </span>
          ) : null}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const FloatingEdge = memo(FloatingEdgeImpl);
