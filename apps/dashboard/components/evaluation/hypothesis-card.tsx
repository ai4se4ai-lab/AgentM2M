import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HypothesisStatus } from "@/lib/bench-client";

const VARIANT: Record<HypothesisStatus["result"], "success" | "warning" | "secondary"> = {
  supported: "success",
  not_supported: "warning",
  pending: "secondary",
};

export function HypothesisCard({ h }: { h: HypothesisStatus }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="font-mono text-sm">{h.id}</CardTitle>
        <Badge variant={VARIANT[h.result]}>{h.result.replace("_", " ")}</Badge>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <p>{h.text}</p>
        <p className="text-xs text-muted-foreground">test: {h.test}</p>
        {h.effect ? (
          <p className="font-mono text-xs">
            effect {h.effect} {h.ci ? `· CI ${h.ci}` : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
