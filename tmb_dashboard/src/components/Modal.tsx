import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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
  actions: ModalAction[];
  onClose: () => void;
  closeOnBackdrop?: boolean;
}

export function Modal({
  open,
  title,
  description,
  actions,
  onClose,
  closeOnBackdrop = true,
}: ModalProps) {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

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
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={event => {
        if (!closeOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h3>{title}</h3>
        </header>
        {description ? <p className="modal-description">{description}</p> : null}
        <footer className="modal-actions">
          {actions.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              ref={index === 0 ? firstButtonRef : null}
              type="button"
              className={`${action.variant === 'danger' ? 'danger-btn' : action.variant === 'ghost' ? 'ghost-btn' : 'primary-btn'} modal-btn`}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </footer>
      </section>
    </div>,
    document.body
  );
}

