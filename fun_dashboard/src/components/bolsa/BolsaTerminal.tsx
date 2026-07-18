"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  MessageCircle,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { PriceChart } from "@/components/bolsa/PriceChart";
import { NewsPaperModal } from "@/components/bolsa/NewsPaperModal";
import { DesktopLayout } from "@/components/bolsa/BolsaDesktop";
import { funApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatCoins,
  formatPct,
} from "@/lib/format";
import {
  loadFavorites,
  saveFavorites,
  toggleFavorite,
} from "@/lib/bolsaFavorites";
import {
  riskLabel,
  riskTone,
  volLabel,
} from "@/lib/bolsaUi";
import type {
  BolsaBoard,
  BolsaEvent,
  BolsaHistory,
  BolsaQuote,
  BolsaRange,
} from "@/lib/types";

const RANGES: { id: BolsaRange; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "all", label: "Tudo" },
];

const REFRESH_MS = 45_000;
/** Desktop sidebar alta: mais itens por página; mobile paginação segue ok. */
const NEWS_PAGE_SIZE = 14;

type Props = {
  scope: string;
  className?: string;
};

export function BolsaTerminal({ scope, className }: Props) {
  const [board, setBoard] = useState<BolsaBoard | null>(null);
  const [events, setEvents] = useState<BolsaEvent[]>([]);
  const [history, setHistory] = useState<BolsaHistory | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [range, setRange] = useState<BolsaRange>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<"delta" | "price" | "ath" | "name">("delta");
  const [filter, setFilter] = useState<"all" | "up" | "down" | "ath">("all");
  const [loading, setLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [boardTick, setBoardTick] = useState(0);
  const [openNews, setOpenNews] = useState<BolsaEvent | null>(null);
  const [newsPage, setNewsPage] = useState(1);
  const [newsTotal, setNewsTotal] = useState(0);
  const [newsTotalPages, setNewsTotalPages] = useState(0);
  const [newsLoading, setNewsLoading] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [chartVariant, setChartVariant] = useState<"area" | "line">("area");
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  /** Sparklines de sessão (últimos ticks polled). */
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  const loadBoard = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    setError(null);
    try {
      const b = await funApi.bolsa(scope);
      setBoard((prev) => {
        if (prev?.quotes?.length) {
          const map: Record<string, number> = {};
          for (const q of prev.quotes) map[q.id] = q.price;
          setPrevPrices(map);
          const sid = selectedRef.current || b.quotes[0]?.id;
          const sel = prev.quotes.find((q) => q.id === sid);
          const nextSel = b.quotes.find((q) => q.id === sid);
          if (sel && nextSel && nextSel.price !== sel.price) {
            setPriceFlash(nextSel.price > sel.price ? "up" : "down");
            window.setTimeout(() => setPriceFlash(null), 600);
          }
        }
        return b;
      });
      setSparks((prev) => {
        const next = { ...prev };
        for (const q of b.quotes) {
          const seed =
            next[q.id]?.length
              ? next[q.id]
              : [Math.max(1, q.previousPrice || q.price), q.price];
          const arr = [...seed];
          if (arr[arr.length - 1] !== q.price) arr.push(q.price);
          next[q.id] = arr.slice(-16);
        }
        return next;
      });
      const t = Date.now();
      setUpdatedAt(t);
      setNextRefreshAt(t + REFRESH_MS);
      setBoardTick((n) => n + 1);
      setSelected((prev) => {
        if (prev && b.quotes.some((q) => q.id === prev)) return prev;
        return b.quotes[0]?.id || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a bolsa");
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const loadNews = useCallback(async () => {
    if (!scope) {
      setEvents([]);
      setNewsTotal(0);
      setNewsTotalPages(0);
      return;
    }
    setNewsLoading(true);
    try {
      const e = await funApi.bolsaEvents(scope, {
        page: newsPage,
        limit: NEWS_PAGE_SIZE,
      });
      setEvents(e.events || []);
      setNewsTotal(e.total || 0);
      setNewsTotalPages(e.totalPages || 0);
      if (e.totalPages > 0 && newsPage > e.totalPages && e.page !== newsPage) {
        setNewsPage(e.page);
      }
    } catch {
      setEvents([]);
      setNewsTotal(0);
      setNewsTotalPages(0);
    } finally {
      setNewsLoading(false);
    }
  }, [scope, newsPage]);

  const loadHistory = useCallback(async () => {
    if (!scope || !selected) {
      setHistory(null);
      return;
    }
    setHistLoading(true);
    try {
      const opts: {
        range?: BolsaRange;
        from?: number;
        to?: number;
      } = {};
      if (fromDate || toDate) {
        if (fromDate) opts.from = new Date(`${fromDate}T00:00:00`).getTime();
        if (toDate) opts.to = new Date(`${toDate}T23:59:59`).getTime();
      } else {
        opts.range = range;
      }
      const h = await funApi.bolsaHistory(scope, selected, opts);
      setHistory(h);
    } catch {
      setHistory(null);
    } finally {
      setHistLoading(false);
    }
  }, [scope, selected, range, fromDate, toDate]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    setNewsPage(1);
  }, [scope]);

  useEffect(() => {
    void loadNews();
  }, [loadNews]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, boardTick]);

  useEffect(() => {
    if (!scope) return;
    const id = window.setInterval(() => {
      void loadBoard();
      void loadNews();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [scope, loadBoard, loadNews]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const quote = useMemo(
    () => board?.quotes.find((q) => q.id === selected) || null,
    [board, selected]
  );

  const rows = useMemo(() => {
    let list = [...(board?.quotes || [])];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (x) =>
          x.name.toLowerCase().includes(q) ||
          x.id.toLowerCase().includes(q) ||
          x.ticker.toLowerCase().includes(q)
      );
    }
    if (filter === "up") list = list.filter((x) => x.deltaPct > 0);
    if (filter === "down") list = list.filter((x) => x.deltaPct < 0);
    if (filter === "ath") list = list.filter((x) => x.atHigh);
    list.sort((a, b) => {
      const af = favorites.includes(a.id) ? 1 : 0;
      const bf = favorites.includes(b.id) ? 1 : 0;
      if (bf !== af) return bf - af;
      if (sort === "price") return b.price - a.price;
      if (sort === "ath") return b.highPrice - a.highPrice;
      if (sort === "name") return a.name.localeCompare(b.name, "pt-BR");
      return b.deltaPct - a.deltaPct;
    });
    return list;
  }, [board, filter, sort, query, favorites]);

  const s = board?.summary;
  const secsLeft = nextRefreshAt
    ? Math.max(0, Math.ceil((nextRefreshAt - nowTick) / 1000))
    : 0;
  const marketOpen = board?.enabled !== false;

  const onToggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, id);
      saveFavorites(next);
      return next;
    });
  };

  const shared = {
    board,
    events,
    history,
    quote,
    rows,
    selected,
    setSelected,
    range,
    setRange,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    sort,
    setSort,
    filter,
    setFilter,
    loading,
    histLoading,
    error,
    loadBoard,
    updatedAt,
    secsLeft,
    marketOpen,
    nowTick,
    newsPage,
    setNewsPage,
    newsTotal,
    newsTotalPages,
    newsLoading,
    openNews,
    setOpenNews,
    favorites,
    onToggleFav,
    query,
    setQuery,
    chartVariant,
    setChartVariant,
    prevPrices,
    sparks,
    priceFlash,
    s,
  };

  return (
    <div className={cn("w-full beco-terminal", className)}>
      {/* Mobile: layout atual compacto */}
      <div className="lg:hidden">
        <MobileLayout {...shared} />
      </div>
      {/* Desktop: terminal full-width */}
      <div className="hidden lg:block">
        <DesktopLayout {...shared} />
      </div>
      <NewsPaperModal
        event={openNews}
        open={Boolean(openNews)}
        onClose={() => setOpenNews(null)}
      />
    </div>
  );
}

type Shared = {
  board: BolsaBoard | null;
  events: BolsaEvent[];
  history: BolsaHistory | null;
  quote: BolsaQuote | null;
  rows: BolsaQuote[];
  selected: string;
  setSelected: (id: string) => void;
  range: BolsaRange;
  setRange: (r: BolsaRange) => void;
  fromDate: string;
  setFromDate: (v: string) => void;
  toDate: string;
  setToDate: (v: string) => void;
  sort: "delta" | "price" | "ath" | "name";
  setSort: (s: "delta" | "price" | "ath" | "name") => void;
  filter: "all" | "up" | "down" | "ath";
  setFilter: (f: "all" | "up" | "down" | "ath") => void;
  loading: boolean;
  histLoading: boolean;
  error: string | null;
  loadBoard: () => Promise<void>;
  updatedAt: number;
  secsLeft: number;
  marketOpen: boolean;
  nowTick: number;
  newsPage: number;
  setNewsPage: React.Dispatch<React.SetStateAction<number>>;
  newsTotal: number;
  newsTotalPages: number;
  newsLoading: boolean;
  openNews: BolsaEvent | null;
  setOpenNews: (e: BolsaEvent | null) => void;
  favorites: string[];
  onToggleFav: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  chartVariant: "area" | "line";
  setChartVariant: (v: "area" | "line") => void;
  prevPrices: Record<string, number>;
  sparks: Record<string, number[]>;
  priceFlash: "up" | "down" | null;
  s: BolsaBoard["summary"] | undefined;
};

/* ═══════════════════════════════════════════
 * MOBILE — layout original (compacto)
 * ═══════════════════════════════════════════ */
function MobileLayout(p: Shared) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <Badge tone="ink">Somente leitura</Badge>
        {p.board?.groupName ? (
          <span className="font-medium text-zinc-800 dark:text-zinc-100">
            {p.board.groupName}
          </span>
        ) : null}
        <span>Compra e venda só no WhatsApp</span>
        {p.secsLeft >= 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono tabular-nums text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            <span className="text-[10px] font-sans uppercase text-zinc-500">
              Próx.
            </span>
            {p.loading ? "…" : `${p.secsLeft}s`}
          </span>
        ) : null}
        {!p.marketOpen ? <Badge tone="warn">Bolsa fechada</Badge> : null}
      </div>

      {p.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {p.error}
        </div>
      ) : null}

      <MetricStrip
        items={[
          { label: "Empresas", value: p.s?.count ?? 0 },
          {
            label: "Alta",
            value: p.s?.advancing ?? 0,
            hint: p.s ? `média ${formatPct(p.s.avgDeltaPct)}` : undefined,
          },
          { label: "Baixa", value: p.s?.declining ?? 0 },
          { label: "No ATH", value: p.s?.atHighCount ?? 0 },
        ]}
      />

      <div className="grid gap-5">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {p.quote ? (
                  <>
                    <span className="mr-1.5">{p.quote.emoji}</span>
                    {p.quote.name}
                    <span className="ml-2 font-mono text-xs text-zinc-400">
                      {p.quote.ticker}
                    </span>
                  </>
                ) : (
                  "Cotação"
                )}
              </h2>
              {p.quote ? (
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {formatCoins(p.quote.price)}
                  </span>
                  <DeltaBadge pct={p.quote.deltaPct} />
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    p.setRange(r.id);
                    p.setFromDate("");
                    p.setToDate("");
                  }}
                  className={cn(
                    "h-8 min-w-[2.5rem] rounded-md px-2 text-xs font-medium",
                    p.range === r.id && !p.fromDate && !p.toDate
                      ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-white text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700"
                  )}
                >
                  {r.label}
                </button>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void p.loadBoard()}
                disabled={p.loading}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", p.loading && "animate-spin")}
                />
              </Button>
            </div>
          </div>

          <PriceChart
            points={p.history?.points || []}
            ath={p.quote?.highPrice || 0}
            height={220}
            variant={p.chartVariant}
          />

          {p.history?.stats ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniStat label="Abertura" value={formatCoins(p.history.stats.open)} />
              <MiniStat label="Máx" value={formatCoins(p.history.stats.high)} />
              <MiniStat label="Mín" value={formatCoins(p.history.stats.low)} />
              <MiniStat
                label="Fechamento"
                value={formatCoins(p.history.stats.close)}
              />
            </div>
          ) : null}

          {p.quote ? (
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-[11px] font-medium uppercase text-zinc-400">
                Sobre a empresa
              </div>
              <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-200">
                {p.quote.blurb}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={riskTone(p.quote.risk)}>
                  Risco {riskLabel(p.quote.risk)}
                </Badge>
                <Badge tone="neutral">
                  Volatilidade {volLabel(p.quote.volatility)}
                </Badge>
                {p.quote.atHigh ? <Badge tone="success">No ATH</Badge> : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Select
              value={p.filter}
              onChange={(e) => p.setFilter(e.target.value as typeof p.filter)}
              className="w-auto min-w-[7rem]"
            >
              <option value="all">Todas</option>
              <option value="up">Em alta</option>
              <option value="down">Em baixa</option>
              <option value="ath">No ATH</option>
            </Select>
            <Select
              value={p.sort}
              onChange={(e) => p.setSort(e.target.value as typeof p.sort)}
              className="w-auto min-w-[7rem]"
            >
              <option value="delta">Variação</option>
              <option value="price">Preço</option>
              <option value="ath">ATH</option>
              <option value="name">Nome</option>
            </Select>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <ul className="max-h-[22rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
              {p.rows.map((q) => (
                <li key={q.id}>
                  <CompanyRow
                    q={q}
                    active={p.selected === q.id}
                    fav={p.favorites.includes(q.id)}
                    prev={p.prevPrices[q.id]}
                    onPick={() => p.setSelected(q.id)}
                    onFav={() => p.onToggleFav(q.id)}
                    dense={false}
                  />
                </li>
              ))}
            </ul>
          </div>

          <Movers board={p.board} onPick={p.setSelected} />

          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Notícias do beco
            </h3>
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {p.events.map((ev) => (
                  <li key={ev.id}>
                    <button
                      type="button"
                      onClick={() => p.setOpenNews(ev)}
                      className="flex w-full gap-2 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {ev.title}
                        </div>
                        {ev.description ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">
                            {ev.description}
                          </p>
                        ) : null}
                      </div>
                      <Badge
                        tone={
                          ev.impactPct > 0
                            ? "success"
                            : ev.impactPct < 0
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {formatPct(ev.impactPct, 0)}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
              {p.newsTotalPages > 1 ? (
                <div className="flex justify-between border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={p.newsPage <= 1}
                    onClick={() => p.setNewsPage((x) => Math.max(1, x - 1))}
                  >
                    Anterior
                  </Button>
                  <span className="text-[11px] tabular-nums">
                    {p.newsPage}/{p.newsTotalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={p.newsPage >= p.newsTotalPages}
                    onClick={() =>
                      p.setNewsPage((x) =>
                        Math.min(p.newsTotalPages || x, x + 1)
                      )
                    }
                  >
                    Próxima
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <TradeCta board={p.board} />
    </div>
  );
}

/* ── atoms ── */

function CompanyRow({
  q,
  active,
  fav,
  prev,
  onPick,
  onFav,
  dense,
}: {
  q: BolsaQuote;
  active: boolean;
  fav: boolean;
  prev?: number;
  onPick: () => void;
  onFav: () => void;
  dense: boolean;
}) {
  return (
    <div
      className={cn(
        "group flex w-full items-stretch gap-0 rounded-lg transition-colors",
        active
          ? "bg-zinc-200 dark:bg-zinc-700/90"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      )}
    >
      <button
        type="button"
        onClick={onPick}
        className={cn(
          "min-w-0 flex-1 grid grid-cols-[1fr_auto_auto] items-center gap-2 text-left",
          dense ? "px-2.5 py-2" : "px-3 py-2.5"
        )}
      >
        <div className="min-w-0">
          <div
            className={cn(
              "truncate font-medium",
              dense ? "text-[13px]" : "text-sm",
              active
                ? "text-zinc-950 dark:text-zinc-50"
                : "text-zinc-900 dark:text-zinc-100"
            )}
          >
            <span className="mr-1">{q.emoji}</span>
            {q.name}
            {q.atHigh ? (
              <Badge tone="success" className="ml-1.5 align-middle">
                ATH
              </Badge>
            ) : null}
          </div>
          <div
            className={cn(
              "truncate text-[11px]",
              active
                ? "text-zinc-700 dark:text-zinc-300"
                : "text-zinc-500 dark:text-zinc-400"
            )}
          >
            {dense ? q.ticker : q.blurb || q.ticker}
          </div>
        </div>
        <PriceFlash
          price={q.price}
          prev={prev}
          className={cn(
            "text-right text-sm tabular-nums font-medium",
            active
              ? "text-zinc-950 dark:text-zinc-50"
              : "text-zinc-900 dark:text-zinc-100"
          )}
        />
        <div
          className={cn(
            "w-14 text-right text-xs tabular-nums font-medium",
            q.deltaPct > 0 && "text-emerald-700 dark:text-emerald-400",
            q.deltaPct < 0 && "text-red-600 dark:text-red-400",
            q.deltaPct === 0 && "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {formatPct(q.deltaPct)}
        </div>
      </button>
      <button
        type="button"
        onClick={onFav}
        className="shrink-0 px-2 text-zinc-400 opacity-70 transition hover:opacity-100 group-hover:opacity-100"
        aria-label={fav ? "Remover favorito" : "Favoritar"}
      >
        <Star
          className={cn("h-3.5 w-3.5", fav && "fill-amber-400 text-amber-400")}
        />
      </button>
    </div>
  );
}

function PriceFlash({
  price,
  prev,
  className,
}: {
  price: number;
  prev?: number;
  className?: string;
}) {
  const dir =
    prev == null ? 0 : price > prev ? 1 : price < prev ? -1 : 0;
  return (
    <span
      className={cn(
        "tabular-nums transition-colors duration-300",
        dir > 0 && "text-emerald-600 dark:text-emerald-400",
        dir < 0 && "text-red-600 dark:text-red-400",
        className
      )}
    >
      {formatCoins(price)}
    </span>
  );
}

function DeltaBadge({ pct, large }: { pct: number; large?: boolean }) {
  const tone =
    pct > 0 ? "success" : pct < 0 ? "danger" : ("neutral" as const);
  return (
    <Badge tone={tone} className={large ? "px-2.5 py-1 text-sm" : undefined}>
      {formatPct(pct)}
    </Badge>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}

function Movers({
  board,
  onPick,
}: {
  board: BolsaBoard | null;
  onPick: (id: string) => void;
}) {
  const g = board?.movers?.topGainers || [];
  const l = board?.movers?.topLosers || [];
  if (!g.length && !l.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <MoverCol title="Maiores altas" items={g} onPick={onPick} up />
      <MoverCol title="Maiores baixas" items={l} onPick={onPick} up={false} />
    </div>
  );
}

function MoverCol({
  title,
  items,
  onPick,
  up,
}: {
  title: string;
  items: BolsaQuote[];
  onPick: (id: string) => void;
  up: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        {title}
      </div>
      <ul className="space-y-0.5">
        {items.map((q) => (
          <li key={q.id}>
            <button
              type="button"
              onClick={() => onPick(q.id)}
              className="flex w-full items-center justify-between gap-1 rounded-md px-1.5 py-1 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                {q.emoji} {q.name}
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums font-medium",
                  up
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                {formatPct(q.deltaPct)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TradeCta({ board }: { board: BolsaBoard | null }) {
  return (
    <aside
      className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <MessageCircle className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
      <div className="min-w-0 flex-1 text-sm text-zinc-700 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">
          Negocie no WhatsApp.
        </span>{" "}
        Este site não aceita ordens.{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
          {board?.tradeHint?.buy || "/bolsa comprar bombatech 3"}
        </code>
        {" · "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
          {board?.tradeHint?.sell || "/bolsa vender pato 1"}
        </code>
      </div>
    </aside>
  );
}
