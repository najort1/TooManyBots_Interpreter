"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
  "aria-label"?: string;
}

export function Switch({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  className,
  size = "md",
  "aria-label": ariaLabel,
}: SwitchProps) {
  const handleClick = () => {
    if (disabled) return;
    onCheckedChange(!checked);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onCheckedChange(!checked);
    }
  };

  const sizes = {
    sm: {
      track: "h-5 w-9",
      thumb: "h-3.5 w-3.5",
      translateChecked: "translate-x-4",
      translateUnchecked: "translate-x-0.5",
    },
    md: {
      track: "h-6 w-11",
      thumb: "h-4.5 w-4.5",
      translateChecked: "translate-x-5.5",
      translateUnchecked: "translate-x-0.5",
    },
    lg: {
      track: "h-7 w-14",
      thumb: "h-5.5 w-5.5",
      translateChecked: "translate-x-7.5",
      translateUnchecked: "translate-x-1",
    },
  };

  const s = sizes[size] || sizes.md;

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100/30 dark:focus-visible:ring-offset-zinc-950",
        disabled && "cursor-not-allowed opacity-50",
        checked
          ? "bg-emerald-600 dark:bg-emerald-500"
          : "bg-zinc-300 dark:bg-zinc-700",
        s.track,
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none inline-block transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out dark:bg-zinc-50",
          s.thumb,
          checked ? s.translateChecked : s.translateUnchecked
        )}
      />
    </button>
  );
}
