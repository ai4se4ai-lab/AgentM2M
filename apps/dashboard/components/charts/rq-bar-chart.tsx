"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SERIES_COLORS = ["#7c6ff0", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#94a3b8"];

export function RqBarChart({
  rows,
  categoryKey,
  valueKeys,
}: {
  rows: Record<string, unknown>[];
  categoryKey: string;
  valueKeys: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey={categoryKey} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {valueKeys.map((key, i) => (
          <Bar key={key} dataKey={key} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Picks a reasonable category key (first non-numeric field) and numeric value keys from row shape. */
export function inferChartFields(rows: Record<string, unknown>[]): { categoryKey: string; valueKeys: string[] } | null {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]);
  const categoryKey = keys.find((k) => typeof rows[0][k] === "string");
  const valueKeys = keys.filter((k) => typeof rows[0][k] === "number");
  if (!categoryKey || valueKeys.length === 0) return null;
  return { categoryKey, valueKeys };
}
