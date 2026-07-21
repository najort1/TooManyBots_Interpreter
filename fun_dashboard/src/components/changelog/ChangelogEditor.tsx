"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { Bold, Code2, Italic, List, Strikethrough, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Props = {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  className?: string;
};

type WrapMode = "bold" | "italic" | "strike" | "code" | "bullet" | "heading";

/**
 * Insere marcação do WhatsApp no texto selecionado.
 * *negrito* · _itálico_ · ~riscado~ · ```mono``` · • lista · *seção*
 */
function wrapSelection(
  value: string,
  start: number,
  end: number,
  mode: WrapMode
): { next: string; selStart: number; selEnd: number } {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  if (mode === "bullet") {
    // aplica • em cada linha da seleção (ou na linha atual se vazio)
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    const blockEndIdx = value.indexOf("\n", end);
    const blockEnd = blockEndIdx === -1 ? value.length : blockEndIdx;
    const block = value.slice(blockStart, blockEnd);
    const lined = block
      .split("\n")
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (/^[-•]\s+/.test(t)) return `• ${t.replace(/^[-•]\s+/, "")}`;
        // não prefixar se já for negrito WA (*texto*)
        if (/^\*[^*].*\*$/.test(t) && !t.includes('\n')) return t;
        return `• ${t}`;
      })
      .join("\n");
    const next = value.slice(0, blockStart) + lined + value.slice(blockEnd);
    return {
      next,
      selStart: blockStart,
      selEnd: blockStart + lined.length,
    };
  }

  if (mode === "heading") {
    const line =
      selected.trim() ||
      value.slice(value.lastIndexOf("\n", start - 1) + 1, end).trim() ||
      "Seção";
    const wrapped = `*${line.replace(/^\*+|\*+$/g, "").trim()}*`;
    if (selected) {
      return {
        next: before + wrapped + after,
        selStart: start,
        selEnd: start + wrapped.length,
      };
    }
    // linha atual
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    const blockEndIdx = value.indexOf("\n", start);
    const blockEnd = blockEndIdx === -1 ? value.length : blockEndIdx;
    const next = value.slice(0, blockStart) + wrapped + value.slice(blockEnd);
    return {
      next,
      selStart: blockStart,
      selEnd: blockStart + wrapped.length,
    };
  }

  const pairs: Record<"bold" | "italic" | "strike" | "code", [string, string]> =
    {
      bold: ["*", "*"],
      italic: ["_", "_"],
      strike: ["~", "~"],
      code: ["```", "```"],
    };
  const [open, close] = pairs[mode];
  const inner = selected || (mode === "code" ? "código" : "texto");
  const wrapped = `${open}${inner}${close}`;
  return {
    next: before + wrapped + after,
    selStart: start + open.length,
    selEnd: start + open.length + inner.length,
  };
}

export function ChangelogEditor({
  value,
  onChange,
  maxLength = 3500,
  className,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const apply = useCallback(
    (mode: WrapMode) => {
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const { next, selStart, selEnd } = wrapSelection(value, start, end, mode);
      const clipped = next.slice(0, maxLength);
      onChange(clipped);
      requestAnimationFrame(() => {
        el.focus();
        const max = clipped.length;
        el.setSelectionRange(
          Math.min(selStart, max),
          Math.min(selEnd, max)
        );
      });
    },
    [value, onChange, maxLength]
  );

  const tools: {
    mode: WrapMode;
    label: string;
    icon: ReactNode;
    title: string;
  }[] = [
    {
      mode: "bold",
      label: "N",
      icon: <Bold className="h-3.5 w-3.5" />,
      title: "Negrito (*texto*)",
    },
    {
      mode: "italic",
      label: "I",
      icon: <Italic className="h-3.5 w-3.5" />,
      title: "Itálico (_texto_)",
    },
    {
      mode: "strike",
      label: "S",
      icon: <Strikethrough className="h-3.5 w-3.5" />,
      title: "Riscado (~texto~)",
    },
    {
      mode: "code",
      label: "C",
      icon: <Code2 className="h-3.5 w-3.5" />,
      title: "Monoespaçado (```texto```)",
    },
    {
      mode: "heading",
      label: "H",
      icon: <Type className="h-3.5 w-3.5" />,
      title: "Título de seção (*Seção*)",
    },
    {
      mode: "bullet",
      label: "•",
      icon: <List className="h-3.5 w-3.5" />,
      title: "Lista com bullet",
    },
  ];

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-950/60">
        {tools.map((t) => (
          <Button
            key={t.mode}
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 px-0"
            title={t.title}
            aria-label={t.title}
            onClick={() => apply(t.mode)}
          >
            {t.icon}
          </Button>
        ))}
        <span className="ml-1 hidden text-[10px] text-zinc-400 sm:inline">
          WhatsApp: *negrito* _itálico_ ~riscado~
        </span>
      </div>
      <textarea
        ref={ref}
        className="min-h-[220px] w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus-visible:ring-zinc-100/20"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        maxLength={maxLength}
        placeholder={[
          "*Bolsa*",
          "Agora dá pra comprar e vender ações das empresas do grupo.",
          "",
          "• /bolsa — cotações",
          "• /carteira — suas ações",
          "",
          "Dividendos raros em *PatoCoin* — detalhes no /ajuda economia.",
        ].join("\n")}
        spellCheck
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
        <span>
          Parágrafos livres · lista só com{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">-</code>{" "}
          ou botão lista ·{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">*negrito*</code>{" "}
          não vira bullet
        </span>
        <span>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
}
