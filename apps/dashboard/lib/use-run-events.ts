"use client";

import { useEffect, useState } from "react";
import { runEventsWsUrl, type TraceEvent } from "@/lib/engine-client";

export type WsConnectionState = "connecting" | "open" | "closed" | "error";

/**
 * Opens the engine's WebSocket trace stream for a run (`/api/runs/:id/events`)
 * and accumulates every TraceEvent frame it sends. Per the contract, the
 * server replays all events so far on connect and then streams live ones —
 * so this is the single source of truth for the event list; no separate
 * REST fetch of `events` is needed once this is connected.
 *
 * IMPORTANT: the wire `TraceEvent` (apps/engine/src/algorithms/run-team.ts)
 * has no `seq`/`ts`/`runId` — only `{ algorithm, step, agentId?, edgeId?,
 * detail? }`. The same (algorithm, step) pair legitimately repeats many
 * times across a run (e.g. "RunTeam"/"schedule" once per obligation), so
 * events must NOT be deduped by content. This hook opens exactly one socket
 * per runId and never reconnects mid-run, so the server's "replay once on
 * connect, then stream" contract never hands us the same frame twice —
 * every message is appended as-is, in arrival order.
 */
export function useRunEvents(runId: string | undefined) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [state, setState] = useState<WsConnectionState>("connecting");

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setState("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(runEventsWsUrl(runId));
    } catch {
      setState("error");
      return;
    }

    socket.onopen = () => setState("open");
    socket.onerror = () => setState("error");
    socket.onclose = () => setState((s) => (s === "error" ? s : "closed"));
    socket.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data as string) as TraceEvent;
        setEvents((prev) => [...prev, evt]);
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      socket.close();
    };
  }, [runId]);

  return { events, connectionState: state };
}
