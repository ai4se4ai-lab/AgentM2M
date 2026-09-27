"use client";

import { useState } from "react";
import { Cloud, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "openrouter", label: "OpenRouter" },
];

export function CloudTab() {
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p>
          Cloud provider execution isn&apos;t wired up in this environment (no API keys configured); this panel shows
          the intended UI only. Keys are never sent from the browser in the real design — the engine's{" "}
          <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
            openai / anthropic / google / openrouter
          </code>{" "}
          bindings are accepted by the schema so a team can reference them, but any run using one currently fails
          with a clear &quot;no provider registered&quot; error from the engine (see engine-api-contract.md).
        </p>
      </div>

      <Card className="max-w-xl opacity-90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-4 w-4" /> Add a cloud provider
          </CardTitle>
          <CardDescription>UI shell — disabled, does not persist or call any provider.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="api-key">API key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <Button className="w-full" disabled title="Not wired up in this environment">
            Save key (disabled)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
