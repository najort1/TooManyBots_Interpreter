"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

export type TabItem = {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

type TabsProps = {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

/**
 * Abas acessíveis controladas (roving tabindex): setas ←/→ movem, Home/End pulam.
 * Combine com `TabsPanel`: o botão usa id `tab-<id>` + aria-controls `panel-<id>`,
 * e o painel correspondente carrega `data-panel-id` igual ao `id` da aba.
 */
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const focusTab = (id: string) => {
    tabRefs.current.get(id)?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length === 0) return;
    let nextId: string | null = null;
    if (event.key === "ArrowRight") nextId = tabs[(index + 1) % tabs.length].id;
    else if (event.key === "ArrowLeft") nextId = tabs[(index - 1 + tabs.length) % tabs.length].id;
    else if (event.key === "Home") nextId = tabs[0].id;
    else if (event.key === "End") nextId = tabs[tabs.length - 1].id;
    if (nextId) {
      event.preventDefault();
      onChange(nextId);
      focusTab(nextId);
    }
  };

  return (
    <div
      role="tablist"
      className={cn(
        "no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800",
        className
      )}
    >
      {tabs.map(({ id, label, icon: Icon }, index) => {
        const selected = id === active;
        return (
          <button
            key={id}
            ref={(el) => {
              if (el) tabRefs.current.set(id, el);
              else tabRefs.current.delete(id);
            }}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={selected}
            aria-controls={`panel-${id}`}
            data-panel-id={id}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              selected
                ? "border-accent text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

type TabsPanelProps = {
  /** id da aba dona deste painel (mesmo id passado em `tabs`) */
  id: string;
  active: string;
  children: React.ReactNode;
  className?: string;
};

/** Painel de aba: fica oculto (hidden) quando inativo, mantendo o estado montado. */
export function TabsPanel({ id, active, children, className }: TabsPanelProps) {
  const isActive = id === active;
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      data-panel-id={id}
      hidden={!isActive}
      className={className}
    >
      {children}
    </div>
  );
}
