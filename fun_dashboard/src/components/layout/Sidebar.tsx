"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Coins,
  LayoutDashboard,
  Settings2,
  Trophy,
  Users,
  Dices,
  Megaphone,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  external?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "OPERAÇÃO",
    items: [
      { href: "/overview", label: "Visão Geral", icon: LayoutDashboard },
      { href: "/groups", label: "Grupos", icon: Users },
      { href: "/ranking", label: "Ranking", icon: Trophy },
      { href: "/logs", label: "Logs ao Vivo", icon: Terminal },
    ],
  },
  {
    title: "ECONOMIA",
    items: [
      { href: "/economia", label: "Gestão de Economia", icon: Coins },
      { href: "/casino", label: "Cassino", icon: Dices },
      { href: "/bolsa", label: "Bolsa do Beco", icon: TrendingUp, external: true },
    ],
  },
  {
    title: "ENGAJAMENTO",
    items: [
      { href: "/desafios", label: "Desafios", icon: Puzzle },
    ],
  },
  {
    title: "SISTEMA & IA",
    items: [
      { href: "/llm", label: "IA & LLM", icon: Sparkles },
      { href: "/selfheal", label: "Auto-aprimorar", icon: ShieldCheck },
      { href: "/changelog", label: "Changelog", icon: Megaphone },
      { href: "/settings", label: "Config", icon: Settings2 },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
            <Coins className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Fun
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Ops do bot
            </div>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2" aria-label="Principal">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {section.title}
            </div>
            {section.items.map(({ href, label, icon: Icon, external }) => {
              if (external) {
                return (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                    <span className="flex-1 truncate">{label}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
                  </a>
                );
              }

              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                  <span className="flex-1 truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <ThemeToggle className="w-full justify-start" variant="ghost" />
        <div className="mt-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          API no bot · UI Next
        </div>
      </div>
    </aside>
  );
}
