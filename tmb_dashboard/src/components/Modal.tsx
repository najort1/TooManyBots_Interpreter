import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export interface ModalAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ModalAction[];
  onClose: () => void;
  closeOnBackdrop?: boolean;
  maxWidthClass?: string;
}

function actionClass(variant: ModalAction['variant']): string {
  if (variant === 'danger') {
    return 'border-[#fecdd3] bg-[#fff1f2] text-[#b4232c] hover:bg-[#ffe4e6]';
  }
  if (variant === 'ghost') {
    return 'border-[#d8e2ef] bg-white/80 text-slate-700 hover:bg-slate-50';
  }
  return 'border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]';
}

export function Modal({
  open,
  title,
  description,
  children,
  actions,
  onClose,
  closeOnBackdrop = true,
  maxWidthClass = 'max-w-[460px]',
}: ModalProps) {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    window.setTimeout(() => {
      firstButtonRef.current?.focus();
      if (!firstButtonRef.current) {
        closeButtonRef.current?.focus();
      }
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-4 backdrop-blur-[3px]"
      onMouseDown={event => {
        if (!closeOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`w-full ${maxWidthClass} rounded-2xl border border-[#d6e4f5] bg-white p-4 shadow-[0_20px_45px_rgba(15,23,42,0.22)]`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-3">
          <h3 className="m-0 text-[1.02rem] font-extrabold text-[#122033]">{title}</h3>
          <button
            ref={closeButtonRef}
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#d8e2ef] bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="Fechar modal"
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        {description ? <p className="mt-2.5 text-sm leading-[1.45] text-slate-600">{description}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {Array.isArray(actions) && actions.length > 0 ? (
          <footer className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {actions.map((action, index) => (
              <button
                key={`${action.label}-${index}`}
                ref={index === 0 ? firstButtonRef : null}
                type="button"
                className={`inline-flex h-9 min-w-[100px] items-center justify-center gap-1 rounded-xl border px-3 text-[0.82rem] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${actionClass(action.variant)}`}
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body
  );
}
