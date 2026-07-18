"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/cn";

type Props = {
  className?: string;
  /** ghost no topbar; secondary em páginas públicas */
  variant?: "ghost" | "secondary";
  size?: "sm" | "md";
};

export function ThemeToggle({
  className,
  variant = "ghost",
  size = "sm",
}: Props) {
  const { theme, toggle, ready } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={toggle}
      className={cn("shrink-0", className)}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Modo claro" : "Modo escuro"}
    >
      {!ready ? (
        <Sun className="h-3.5 w-3.5 opacity-40" aria-hidden />
      ) : isDark ? (
        <Sun className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Moon className="h-3.5 w-3.5" aria-hidden />
      )}
      <span className="hidden sm:inline">{isDark ? "Claro" : "Escuro"}</span>
    </Button>
  );
}
