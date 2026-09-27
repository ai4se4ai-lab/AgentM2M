"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { listTeams, startRun, EngineError } from "@/lib/engine-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_TASK =
  "Duration.parse('P2Y') throws instead of returning a Duration for a bare years-only ISO-8601 period. Fix the parser and add regression coverage.";

export function RunLauncherForm({ defaultTeamId }: { defaultTeamId?: string }) {
  const router = useRouter();
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: listTeams });
  const [teamId, setTeamId] = useState(defaultTeamId ?? "");
  const [task, setTask] = useState(DEFAULT_TASK);
  const [budget, setBudget] = useState(20);

  useEffect(() => {
    if (!teamId && teamsQuery.data && teamsQuery.data.length > 0) {
      setTeamId(defaultTeamId ?? teamsQuery.data[0].id);
    }
  }, [teamsQuery.data, teamId, defaultTeamId]);

  const launchMutation = useMutation({
    mutationFn: () => startRun({ teamId, task, budget }),
    onSuccess: (res) => router.push(`/runs/${res.id}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="h-4 w-4" /> Launch a run
        </CardTitle>
        <CardDescription>
          Starts <code className="font-mono text-xs">RunTeam</code> against the real engine. The bound Ollama model
          will actually be called, so expect this to take real seconds (often 10-60s+) per obligation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="team">Team</Label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger id="team">
              <SelectValue placeholder="Select a team" />
            </SelectTrigger>
            <SelectContent>
              {(teamsQuery.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="task">Task</Label>
          <Textarea id="task" value={task} onChange={(e) => setTask(e.target.value)} rows={4} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="budget">Budget (max obligations)</Label>
          <Input
            id="budget"
            type="number"
            min={1}
            max={200}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="w-32"
          />
        </div>

        <Button
          className="w-full"
          disabled={!teamId || !task || launchMutation.isPending}
          onClick={() => launchMutation.mutate()}
        >
          {launchMutation.isPending ? <Spinner /> : <PlayCircle />}
          {launchMutation.isPending ? "Starting..." : "Start run"}
        </Button>

        {launchMutation.isError ? (
          <p className="text-xs text-destructive">
            {launchMutation.error instanceof EngineError ? launchMutation.error.message : "Failed to start run."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
