"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  HardDrive,
  Plug,
  Plus,
  RefreshCcw,
  X,
} from "lucide-react";
import {
  addOllamaHost,
  listOllamaHostModels,
  listOllamaHosts,
  testConnection,
  EngineError,
  type OllamaHost,
  type TestConnectionResult,
} from "@/lib/engine-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";

export function OllamaTab() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("local");
  const [url, setUrl] = useState("http://localhost:11434");
  const [testResult, setTestResult] = useState<TestConnectionResult | { ok: false; error: string; models: [] } | null>(
    null,
  );

  const hostsQuery = useQuery({ queryKey: ["ollama-hosts"], queryFn: listOllamaHosts });

  const testMutation = useMutation({
    mutationFn: (u: string) => testConnection(u),
    onSuccess: (result) => setTestResult(result),
    onError: (err) =>
      setTestResult({ ok: false, models: [], error: err instanceof Error ? err.message : String(err) }),
  });

  const addHostMutation = useMutation({
    mutationFn: addOllamaHost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ollama-hosts"] });
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Register a host</CardTitle>
          <CardDescription>
            Point at any reachable Ollama server (local machine, LAN GPU box, etc).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="host-name">Host name</Label>
            <Input id="host-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="workstation" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="host-url">Host URL</Label>
            <Input
              id="host-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={testMutation.isPending || !url}
              onClick={() => testMutation.mutate(url)}
            >
              {testMutation.isPending ? <Spinner /> : <Plug />}
              Test connection
            </Button>
            <Button
              className="flex-1"
              disabled={addHostMutation.isPending || !name || !url}
              onClick={() => addHostMutation.mutate({ name, url })}
            >
              {addHostMutation.isPending ? <Spinner /> : <Plus />}
              Add host
            </Button>
          </div>

          {testResult ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                testResult.ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {testResult.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                {testResult.ok ? `Reachable · ${testResult.models.length} model(s) discovered` : "Unreachable"}
              </div>
              {!testResult.ok && "error" in testResult && testResult.error ? (
                <p className="mt-1 text-xs opacity-80">{testResult.error}</p>
              ) : null}
              {testResult.ok && testResult.models.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {testResult.models.slice(0, 8).map((m) => (
                    <Badge key={m} variant="outline" className="font-mono text-[10px]">
                      {m}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {addHostMutation.isError ? (
            <p className="text-xs text-destructive">
              {addHostMutation.error instanceof EngineError
                ? addHostMutation.error.message
                : "Failed to add host."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Registered hosts</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["ollama-hosts"] })}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {hostsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading hosts...
          </div>
        ) : hostsQuery.error ? (
          <EmptyState
            icon={AlertTriangle}
            variant="error"
            title="Could not load registered hosts"
            description={hostsQuery.error instanceof EngineError ? hostsQuery.error.message : "Unknown error."}
          />
        ) : !hostsQuery.data || hostsQuery.data.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title="No Ollama hosts registered yet"
            description="Add a host on the left to discover real local models."
          />
        ) : (
          <div className="space-y-3">
            {hostsQuery.data.map((host) => (
              <HostModelsCard key={host.id} host={host} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HostModelsCard({ host }: { host: OllamaHost }) {
  const modelsQuery = useQuery({
    queryKey: ["ollama-host-models", host.id],
    queryFn: () => listOllamaHostModels(host.id),
  });

  return (
    <Card data-testid={`ollama-host-card-${host.name}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{host.name}</CardTitle>
          <CardDescription className="truncate font-mono text-xs">{host.url}</CardDescription>
        </div>
        {modelsQuery.isLoading ? (
          <Spinner />
        ) : modelsQuery.error ? (
          <Badge variant="destructive" className="ml-3 shrink-0">unreachable</Badge>
        ) : (
          <Badge variant="success" className="ml-3 shrink-0">{modelsQuery.data?.length ?? 0} models</Badge>
        )}
      </CardHeader>
      <CardContent>
        {modelsQuery.error ? (
          <p className="text-xs text-destructive">
            {modelsQuery.error instanceof EngineError ? modelsQuery.error.message : "Failed to list models."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(modelsQuery.data ?? []).map((m) => (
              <div key={m.name} className="rounded-md border border-border px-3 py-2">
                <p className="truncate font-mono text-xs font-medium">{m.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  {m.details?.parameter_size ? <span>{m.details.parameter_size}</span> : null}
                  {m.details?.quantization_level ? <span>· {m.details.quantization_level}</span> : null}
                  {typeof m.size === "number" ? <span>· {(m.size / 1e9).toFixed(1)} GB</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
