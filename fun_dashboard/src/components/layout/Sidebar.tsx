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
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/overview", label: "Visão", icon: LayoutDashboard },
  { href: "/ranking", label: "Ranking", icon: Trophy },
  { href: "/casino", label: "Cassino", icon: Dices },
  { href: "/groups", label: "Grupos", icon: Users },
  { href: "/settings", label: "Config", icon: Settings2 },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-zinc-50">
            <Coins className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-900">Fun</div>
            <div className="text-[11px] text-zinc-500">Ops do bot</div>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Principal">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-zinc-100 font-medium text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              )}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 p-3 text-[11px] leading-relaxed text-zinc-400">
        API no bot · UI Next
      </div>
    </aside>
  );
}
