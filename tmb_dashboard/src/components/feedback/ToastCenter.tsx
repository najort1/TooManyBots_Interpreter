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

function toneClass(tone: ToastTone): string {
  if (tone === 'success') return 'bg-[#e6fbf2] text-[#0f766e]';
  if (tone === 'warning') return 'bg-[#fff6e6] text-[#b45309]';
  if (tone === 'danger') return 'bg-[#fff0f1] text-[#be123c]';
  return 'bg-[#e6f0ff] text-[#245fb3]';
}

export function ToastCenter({ items, onDismiss }: ToastCenterProps) {
  return (
    <aside
      className="pointer-events-none fixed right-4 top-[84px] z-[70] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2 max-sm:left-2 max-sm:right-2 max-sm:top-[68px] max-sm:w-auto"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map(item => (
        <article
          key={item.id}
          className="pointer-events-auto grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-[14px] border border-[#d6e3f4] bg-[rgba(255,255,255,0.97)] p-3 shadow-[0_14px_34px_rgba(18,32,51,0.15)] backdrop-blur-[8px]"
        >
          <div className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[0.82rem] ${toneClass(item.tone)}`} aria-hidden="true">
            <i className={toneIcon(item.tone)} />
          </div>
          <div>
            <strong className="block text-[0.82rem] text-[#17314f]">{item.title}</strong>
            <p className="mt-0.5 text-[0.79rem] leading-[1.35] text-[#4a5f79]">{item.message}</p>
          </div>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[#6d8097] hover:bg-[#eef4fd]"
            aria-label="Fechar notificacao"
            onClick={() => onDismiss(item.id)}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </article>
      ))}
    </aside>
  );
}
