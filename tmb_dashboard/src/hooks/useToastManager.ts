import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastItem, ToastTone } from '../components/feedback/ToastCenter';
import { mapMessageToTone } from '../lib/appUtils';

export function useToastManager() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts(previous => previous.filter(item => item.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback((title: string, message: string, tone: ToastTone = 'info', ttlMs = 4200) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(previous => [...previous.slice(-4), { id, title, message, tone }]);
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, ttlMs);
    toastTimersRef.current.set(id, timer);
  }, [dismissToast]);

  const showNotice = useCallback((message: string) => {
    pushToast('Notificacao', message, mapMessageToTone(message));
  }, [pushToast]);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return {
    toasts,
    dismissToast,
    pushToast,
    showNotice,
  };
}
