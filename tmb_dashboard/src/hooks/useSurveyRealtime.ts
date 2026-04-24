import { useEffect, useRef } from 'react';

const SURVEY_EVENT_TYPES = new Set([
  'survey:response:completed',
  'survey:response:abandoned',
  'survey:metrics:updated',
  'survey:realtime:stats',
]);

export function useSurveyRealtime(
  onRefresh: () => void,
  {
    enabled = true,
    debounceMs = 500,
  }: {
    enabled?: boolean;
    debounceMs?: number;
  } = {}
) {
  const refreshRef = useRef(onRefresh);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    ws.onmessage = event => {
      try {
        const parsed = JSON.parse(String(event.data || '')) as {
          type?: string;
          payload?: unknown;
        };

        const messages = parsed?.type === 'events' && Array.isArray(parsed.payload)
          ? parsed.payload
          : (parsed?.type === 'event' && parsed.payload ? [parsed.payload] : []);

        let hasSurveyUpdate = false;
        for (const item of messages) {
          if (!item || typeof item !== 'object') continue;
          const eventType = String((item as { eventType?: string }).eventType || '').trim().toLowerCase();
          if (SURVEY_EVENT_TYPES.has(eventType)) {
            hasSurveyUpdate = true;
            break;
          }
        }

        if (!hasSurveyUpdate) return;

        if (timerRef.current) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          refreshRef.current();
        }, debounceMs);
      } catch {
        // ignore malformed payload
      }
    };

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (ws.readyState < WebSocket.CLOSING) {
        ws.close();
      }
    };
  }, [debounceMs, enabled]);
}
