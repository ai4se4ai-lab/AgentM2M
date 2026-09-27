"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useActiveJobCount } from "@/lib/use-bench-jobs";
import {
  Users,
  Cpu,
  PlayCircle,
  FlaskConical,
  BarChart3,
  Network,
} from "lucide-react";

const items = [
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/runs", label: "Runs", icon: PlayCircle },
  { href: "/benchmarks", label: "Benchmarks", icon: FlaskConical },
  { href: "/evaluation", label: "Evaluation", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();
  const activeBenchJobs = useActiveJobCount();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Network className="h-4 w-4" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold">AgentM2M</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Control Plane</span>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {(item.href === "/benchmarks" || item.href === "/evaluation") && activeBenchJobs > 0 ? (
                <span
                  className="ml-auto rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent"
                  title={`${activeBenchJobs} bench job(s) running`}
                  data-testid="active-jobs-badge"
                >
                  {activeBenchJobs} running
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-3 border-t border-border p-3 text-[11px] text-muted-foreground">
        <ThemeToggle />
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-success" />
          </span>
          Engine · <code className="font-mono">localhost:4000</code>
        </div>
      </div>
    </aside>
  );
}
