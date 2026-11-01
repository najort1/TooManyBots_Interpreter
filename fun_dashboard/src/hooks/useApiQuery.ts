"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UseApiQueryReturn<T> = {
  data: T | null;
  /** true apenas na primeira carga (ainda sem dados) */
  loading: boolean;
  /** true durante recargas em segundo plano (já existe data, possivelmente obsoleta) */
  refreshing: boolean;
  error: Error | null;
  /** reexecuta o fetcher agora e devolve a promise do resultado (null se ficou obsoleta) */
  reload: () => Promise<T | null>;
};

/**
 * Busca declarativa para páginas ops: roda o fetcher ao montar e sempre que `deps` muda.
 * Respostas de gerações antigas (deps trocadas no meio do voo ou reload concorrente)
 * são descartadas via contador de geração — mesmo padrão de src/lib/realtimeLifecycle.ts
 * e da página de logs. Seguro com StrictMode (a execução duplicada do effect resolve
 * para a geração mais recente).
 */
export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[]
): UseApiQueryReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(true);
  const generationRef = useRef(0);

  // o fetcher pode mudar a cada render sem entrar em deps — guarda em ref
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (): Promise<T | null> => {
    const generation = ++generationRef.current;
    setPending(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (generation !== generationRef.current) return null; // resposta obsoleta
      setData(result);
      return result;
    } catch (err) {
      if (generation !== generationRef.current) return null;
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      if (generation === generationRef.current) {
        setPending(false);
      }
    }
  }, []);

  useEffect(() => {
    void run();
    // deps é controlado pelo chamador (ex.: [scope]) — igual ao padrão atual das páginas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(), [run]);

  return {
    data,
    loading: pending && data === null,
    refreshing: pending && data !== null,
    error,
    reload,
  };
}
