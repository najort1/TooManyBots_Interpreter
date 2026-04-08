export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  tone: ToastTone;
}

interface ToastCenterProps {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}

function toneIcon(tone: ToastTone): string {
  if (tone === 'success') return 'fa-regular fa-circle-check';
  if (tone === 'warning') return 'fa-solid fa-triangle-exclamation';
  if (tone === 'danger') return 'fa-solid fa-circle-exclamation';
  return 'fa-regular fa-bell';
}

export function ToastCenter({ items, onDismiss }: ToastCenterProps) {
  return (
    <aside className="toast-center" aria-live="polite" aria-atomic="false">
      {items.map(item => (
        <article key={item.id} className={`toast-card toast-${item.tone}`}>
          <div className="toast-icon" aria-hidden="true">
            <i className={toneIcon(item.tone)} />
          </div>
          <div className="toast-body">
            <strong>{item.title}</strong>
            <p>{item.message}</p>
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Fechar notificação"
            onClick={() => onDismiss(item.id)}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </article>
      ))}
    </aside>
  );
}
