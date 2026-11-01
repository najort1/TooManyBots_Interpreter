"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { trapTabKey } from "@/components/ui/focusTrap";

const sizes = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof sizes;
};

/** Entrada de um diálogo aberto na pilha global. */
type DialogEntry = {
  getPanel: () => HTMLElement | null;
  requestClose: () => void;
};

/**
 * Pilha de diálogos abertos (escopo de módulo): com dois diálogos empilhados,
 * só o TOPO responde a Escape e faz o trap de Tab — senão os dois handlers
 * disparariam (stopPropagation não cancela listeners no mesmo nó) e os traps
 * brigarhariam entre si.
 */
const dialogStack: DialogEntry[] = [];

/** Scroll lock ref-counted: trava no primeiro open, destrava só quando a pilha esvazia. */
let scrollLockCount = 0;

function lockPageScroll() {
  if (scrollLockCount++ === 0) {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }
}

function unlockPageScroll() {
  if (--scrollLockCount === 0) {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  }
}

/** Listener único do documento (capture): apenas o diálogo no topo da pilha age. */
function handleStackKeyDown(event: KeyboardEvent) {
  const top = dialogStack[dialogStack.length - 1];
  if (!top) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    top.requestClose();
    return;
  }
  const panel = top.getPanel();
  if (panel) trapTabKey(event, panel);
}

/**
 * Modal acessível sem dependências externas: portal no body, Escape/backdrop fecham,
 * foco entra no painel ao abrir e volta ao elemento anterior ao fechar, Tab cicla
 * dentro do diálogo e o scroll do fundo fica travado. Diálogos empilhados são
 * coordenados pela pilha global (só o topo reage a teclado).
 */
export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: Props) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const entryRef = useRef<DialogEntry | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // mantém a closure da pilha com o onClose mais recente (a entrada é estável
  // para não ser reempilhada no topo quando o pai re-renderiza com novo callback)
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  if (entryRef.current === null) {
    entryRef.current = {
      getPanel: () => panelRef.current,
      requestClose: () => onCloseRef.current(),
    };
  }

  // Foco + scroll lock enquanto aberto. `mounted` nas deps garante o foco inicial
  // quando o diálogo já abre montado (open=true no primeiro commit do cliente).
  useEffect(() => {
    if (!open || !mounted) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    lockPageScroll();
    panelRef.current?.focus();

    return () => {
      unlockPageScroll();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open, mounted]);

  // Registra/desregistra na pilha global; o listener do documento existe apenas
  // enquanto há diálogos abertos.
  useEffect(() => {
    if (!open || !mounted) return;
    const entry = entryRef.current;
    if (!entry) return;
    dialogStack.push(entry);
    if (dialogStack.length === 1) {
      document.addEventListener("keydown", handleStackKeyDown, true);
    }

    return () => {
      const index = dialogStack.indexOf(entry);
      if (index !== -1) dialogStack.splice(index, 1);
      if (dialogStack.length === 0) {
        document.removeEventListener("keydown", handleStackKeyDown, true);
      }
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-zinc-950/60 transition-opacity duration-200 dark:bg-black/70"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full max-h-[85vh] overflow-y-auto rounded-xl outline-none",
          "border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900",
          "transition-transform duration-200",
          sizes[size]
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 -mt-1 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children ? <div className="p-4">{children}</div> : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
