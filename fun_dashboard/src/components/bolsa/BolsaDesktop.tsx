"use client";

import {
  LineChart,
  RefreshCw,
  Star,
  Activity,
  Search,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PriceChart } from "@/components/bolsa/PriceChart";
import { MiniSpark } from "@/components/bolsa/MiniSpark";
import { cn } from "@/lib/cn";
import { formatCoins, formatPct, formatWhen } from "@/lib/format";
import {
  cardClass,
  formatClock,
  impactStars,
  newsAffects,
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

export type DesktopProps = {
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

/**
 * Terminal desktop AAA — gráfico ~70% da coluna central, menos cards, watchlist viva.
 */
export function DesktopLayout(p: DesktopProps) {
  const quotes = p.board?.quotes || [];
  const avg = p.s?.avgDeltaPct ?? 0;
  const indexHint =
    avg > 0.3 ? "Índice em alta" : avg < -0.3 ? "Índice em baixa" : "Índice estável";

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 px-1 xl:px-0">
      {/* Status terminal — uma linha densa */}
      <header className={cn(cardClass, "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5")}>
        <span className="beco-mark text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          Terminal
        </span>
        <Badge tone={p.marketOpen ? "success" : "warn"} className="beco-badge">
          {p.marketOpen ? "● Aberto" : "● Fechado"}
        </Badge>
        <span className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {formatClock(p.nowTick)}
        </span>
        <span className="hidden text-[11px] text-zinc-500 sm:inline dark:text-zinc-400">
          {indexHint} · média {formatPct(avg)}
        </span>
        <span className="hidden text-[11px] text-zinc-500 md:inline dark:text-zinc-400">
          ▲ {p.s?.advancing ?? 0} · ▼ {p.s?.declining ?? 0} · ATH {p.s?.atHighCount ?? 0}
        </span>
        {p.board?.groupName ? (
          <span className="truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
            {p.board.groupName}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
            tick {p.loading ? "…" : `${p.secsLeft}s`}
          </span>
          {p.updatedAt ? (
            <span className="hidden text-[11px] text-zinc-500 lg:inline dark:text-zinc-500">
              sync {formatWhen(p.updatedAt)}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            className="beco-btn-skew h-8"
            onClick={() => void p.loadBoard()}
            disabled={p.loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", p.loading && "animate-spin")} />
            Sync
          </Button>
        </div>
      </header>

      {p.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {p.error}
        </div>
      ) : null}

      {/* Radar — cards altos */}
      <RadarStrip board={p.board} onPick={p.setSelected} />

      <div className="grid grid-cols-12 gap-4 xl:gap-5">
        {/* WATCHLIST */}
        <aside className="col-span-12 flex flex-col gap-4 xl:col-span-3">
          <div className={cn(cardClass, "flex min-h-0 flex-1 flex-col")}>
            <div className="border-b border-zinc-100 px-3 py-3 dark:border-zinc-800/80">
              <div className="beco-mark text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
                Watchlist
              </div>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  value={p.query}
                  onChange={(e) => p.setQuery(e.target.value)}
                  placeholder="Buscar…"
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50/80 pl-8 pr-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100"
                />
              </div>
              <div className="mt-2 flex gap-2">
                <Select
                  value={p.filter}
                  onChange={(e) => p.setFilter(e.target.value as typeof p.filter)}
                  className="h-8 text-xs"
                >
                  <option value="all">Todas</option>
                  <option value="up">Alta</option>
                  <option value="down">Baixa</option>
                  <option value="ath">ATH</option>
                </Select>
                <Select
                  value={p.sort}
                  onChange={(e) => p.setSort(e.target.value as typeof p.sort)}
                  className="h-8 text-xs"
                >
                  <option value="delta">Var</option>
                  <option value="price">Preço</option>
                  <option value="ath">ATH</option>
                  <option value="name">Nome</option>
                </Select>
              </div>
            </div>

            {p.favorites.length > 0 ? (
              <div className="flex flex-wrap gap-1 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/80">
                {p.favorites.map((id) => {
                  const q = quotes.find((x) => x.id === id);
                  if (!q) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => p.setSelected(id)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition active:scale-[0.98]",
                        p.selected === id
                          ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                      )}
                    >
                      ★ {q.name}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <ul className="max-h-[min(58vh,560px)] flex-1 space-y-0.5 overflow-y-auto p-2">
              {p.rows.map((q) => (
                <WatchRow
                  key={q.id}
                  q={q}
                  active={p.selected === q.id}
                  fav={p.favorites.includes(q.id)}
                  spark={p.sparks[q.id] || []}
                  prev={p.prevPrices[q.id]}
                  onPick={() => p.setSelected(q.id)}
                  onFav={() => p.onToggleFav(q.id)}
                />
              ))}
            </ul>
          </div>

          <MarketHeatmap
            quotes={quotes}
            selected={p.selected}
            onPick={p.setSelected}
          />
        </aside>

        {/* CENTER — gráfico domina (mesma altura de linha da coluna de notícias) */}
        <section className="col-span-12 flex min-h-0 flex-col xl:col-span-6 xl:h-full">
          {p.quote ? (
            <div className="mb-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-[22px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-[26px]">
                      <span className="mr-2 opacity-90">{p.quote.emoji}</span>
                      {p.quote.name}
                    </h2>
                    <span className="font-mono text-[13px] text-zinc-500 dark:text-zinc-500">
                      {p.quote.ticker}
                    </span>
                    <button
                      type="button"
                      onClick={() => p.onToggleFav(p.quote!.id)}
                      className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800"
                      aria-label="Favoritar"
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          p.favorites.includes(p.quote.id) &&
                            "fill-amber-400 text-amber-400"
                        )}
                      />
                    </button>
                  </div>

                  {/* LED price panel */}
                  <div className="mt-4 flex flex-wrap items-end gap-4">
                    <div
                      className={cn(
                        "beco-price-led text-[48px] font-semibold leading-none tracking-tight text-zinc-900 dark:text-zinc-50 md:text-[56px]",
                        p.priceFlash === "up" && "beco-flash-up",
                        p.priceFlash === "down" && "beco-flash-down"
                      )}
                    >
                      {formatCoins(p.quote.price)}
                    </div>
                    <div className="mb-1.5 flex flex-col gap-1">
                      <span
                        className={cn(
                          "text-lg font-semibold tabular-nums",
                          p.quote.deltaPct > 0 && "text-emerald-600 dark:text-emerald-400",
                          p.quote.deltaPct < 0 && "text-red-500 dark:text-red-400",
                          p.quote.deltaPct === 0 && "text-zinc-500"
                        )}
                      >
                        {p.quote.deltaPct > 0 ? "▲" : p.quote.deltaPct < 0 ? "▼" : "●"}{" "}
                        {formatPct(p.quote.deltaPct)}
                      </span>
                      <span className="text-[12px] text-zinc-500 dark:text-zinc-500">
                        {p.marketOpen ? "Mercado aberto" : "Mercado fechado"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge tone={p.marketOpen ? "success" : "warn"} className="beco-badge">
                      {p.marketOpen ? "Aberto" : "Fechado"}
                    </Badge>
                    {p.quote.atHigh ? (
                      <Badge tone="success" className="beco-badge">
                        ATH
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="beco-badge">
                        ATH {formatCoins(p.quote.highPrice)}
                      </Badge>
                    )}
                    <Badge tone={riskTone(p.quote.risk)} className="beco-badge">
                      Risco {riskLabel(p.quote.risk)}
                    </Badge>
                    {p.quote.dividendRare ? (
                      <Badge tone="warn" className="beco-badge">
                        Div. raro
                      </Badge>
                    ) : p.quote.dividendYield > 0 ? (
                      <Badge tone="success" className="beco-badge">
                        Yield {(p.quote.dividendYield * 100).toFixed(1)}%
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Filtros com respiro */}
          <div className="mb-6 flex flex-wrap items-center gap-2">
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
                  "beco-btn-skew h-9 min-w-[2.75rem] rounded-lg px-3 text-xs font-semibold transition active:scale-[0.98]",
                  p.range === r.id && !p.fromDate && !p.toDate
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-transparent text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-900"
                )}
              >
                {r.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
            {(["area", "line"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => p.setChartVariant(v)}
                className={cn(
                  "h-9 rounded-lg px-3 text-xs font-medium capitalize",
                  p.chartVariant === v
                    ? "bg-zinc-200/80 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
                )}
              >
                {v === "area" ? "Área" : "Linha"}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <input
                type="date"
                value={p.fromDate}
                onChange={(e) => p.setFromDate(e.target.value)}
                className="h-9 rounded-lg border border-zinc-200 bg-transparent px-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              />
              <input
                type="date"
                value={p.toDate}
                onChange={(e) => p.setToDate(e.target.value)}
                className="h-9 rounded-lg border border-zinc-200 bg-transparent px-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              />
            </div>
          </div>

          {/* GRÁFICO — ~70% visual da coluna */}
          <PriceChart
            points={p.history?.points || []}
            ath={p.quote?.highPrice || p.history?.quote?.highPrice || 0}
            height={460}
            variant={p.chartVariant}
            className="min-h-[min(52vh,460px)] flex-1"
          />

          {/* Uma seção de estatísticas (anti card-fatigue) */}
          <div className={cn(cardClass, "mt-6 px-5 py-4")}>
            <div className="beco-mark text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
              Estatísticas
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              <StatLine
                label="Preço"
                value={formatCoins(p.quote?.price ?? 0)}
                sub={p.quote ? formatPct(p.quote.deltaPct) : undefined}
                emphasize
              />
              <StatLine
                label="Máx período"
                value={formatCoins(p.history?.stats?.high ?? p.quote?.highPrice ?? 0)}
              />
              <StatLine
                label="Mín período"
                value={formatCoins(p.history?.stats?.low ?? 0)}
              />
              <StatLine
                label="Fechamento"
                value={formatCoins(p.history?.stats?.close ?? p.quote?.price ?? 0)}
              />
            </div>
            <div className="my-4 h-px bg-zinc-200 dark:bg-zinc-800" />
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              <StatLine
                label="Abertura"
                value={formatCoins(p.history?.stats?.open ?? 0)}
                muted
              />
              <StatLine
                label="Yield"
                value={
                  p.quote?.dividendRare
                    ? "Raro"
                    : p.quote && p.quote.dividendYield > 0
                      ? `${(p.quote.dividendYield * 100).toFixed(1)}%`
                      : "—"
                }
                muted
              />
              <StatLine
                label="Volatilidade"
                value={p.quote ? volLabel(p.quote.volatility) : "—"}
                muted
              />
              <StatLine
                label="Amostras"
                value={
                  p.history?.stats
                    ? String(p.history.stats.samples)
                    : p.histLoading
                      ? "…"
                      : "—"
                }
                muted
              />
            </div>
            {p.quote?.blurb ? (
              <>
                <div className="my-4 h-px bg-zinc-200 dark:bg-zinc-800" />
                <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {p.quote.blurb}
                </p>
              </>
            ) : null}
          </div>
        </section>

        {/* NEWS — altura alinhada à coluna do gráfico + Estatísticas */}
        <aside className="col-span-12 flex min-h-0 flex-col xl:col-span-3">
          <div className={cn(cardClass, "flex h-full min-h-0 flex-1 flex-col")}>
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800/80">
              <h3 className="beco-mark flex items-center gap-1.5 text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">
                <LineChart className="h-3.5 w-3.5 opacity-50" />
                Notícias
              </h3>
              {p.newsTotal > 0 ? (
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {p.newsTotal}
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
              {!p.events.length && !p.newsLoading ? (
                <p className="py-8 text-center text-[13px] text-zinc-500">Sem eventos.</p>
              ) : (
                p.events.map((ev) => (
                  <NewsCardCompact
                    key={ev.id}
                    event={ev}
                    quotes={quotes}
                    onOpen={() => p.setOpenNews(ev)}
                  />
                ))
              )}
            </div>
            {p.newsTotalPages > 1 ? (
              <div className="flex shrink-0 items-center justify-between border-t border-zinc-100 px-2 py-2 dark:border-zinc-800/80">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={p.newsPage <= 1 || p.newsLoading}
                  onClick={() => p.setNewsPage((x) => Math.max(1, x - 1))}
                >
                  Ant.
                </Button>
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {p.newsPage}/{p.newsTotalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={p.newsPage >= p.newsTotalPages || p.newsLoading}
                  onClick={() =>
                    p.setNewsPage((x) =>
                      p.newsTotalPages ? Math.min(p.newsTotalPages, x + 1) : x
                    )
                  }
                >
                  Próx.
                </Button>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function WatchRow({
  q,
  active,
  fav,
  spark,
  prev,
  onPick,
  onFav,
}: {
  q: BolsaQuote;
  active: boolean;
  fav: boolean;
  spark: number[];
  prev?: number;
  onPick: () => void;
  onFav: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-xl transition-all duration-200",
        active
          ? "beco-active-row bg-zinc-100 dark:bg-[#202025]"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      )}
    >
      <button
        type="button"
        onClick={onPick}
        className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-2 px-2.5 py-2 text-left"
      >
        <div className="min-w-0">
          <div
            className={cn(
              "truncate text-[13px] font-medium",
              active
                ? "text-zinc-900 dark:text-zinc-50"
                : "text-zinc-800 dark:text-zinc-200"
            )}
          >
            <span className="mr-1 opacity-90">{q.emoji}</span>
            {q.name}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-500">
              {q.ticker}
            </span>
            <MiniSpark values={spark} width={52} height={16} />
          </div>
        </div>
        <div className="text-right">
          <div
            className={cn(
              "text-[13px] font-semibold tabular-nums",
              active
                ? "text-zinc-900 dark:text-zinc-50"
                : "text-zinc-700 dark:text-zinc-300",
              prev != null &&
                q.price > prev &&
                "text-emerald-600 dark:text-emerald-400",
              prev != null && q.price < prev && "text-red-500 dark:text-red-400"
            )}
          >
            {formatCoins(q.price)}
          </div>
          <div
            className={cn(
              "text-[11px] font-medium tabular-nums",
              q.deltaPct > 0 && "text-emerald-600 dark:text-emerald-400",
              q.deltaPct < 0 && "text-red-500 dark:text-red-400",
              q.deltaPct === 0 && "text-zinc-500"
            )}
          >
            {formatPct(q.deltaPct)}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onFav}
        className="shrink-0 px-2 py-2 text-zinc-500 opacity-60 transition hover:opacity-100"
        aria-label="Favorito"
      >
        <Star
          className={cn("h-3.5 w-3.5", fav && "fill-amber-400 text-amber-400 opacity-100")}
        />
      </button>
    </div>
  );
}

function StatLine({
  label,
  value,
  sub,
  emphasize,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 tabular-nums tracking-tight",
          emphasize
            ? "text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
            : muted
              ? "text-[15px] font-medium text-zinc-600 dark:text-zinc-400"
              : "text-lg font-semibold text-zinc-800 dark:text-zinc-200"
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-500">{sub}</div>
      ) : null}
    </div>
  );
}

function RadarStrip({
  board,
  onPick,
}: {
  board: BolsaBoard | null;
  onPick: (id: string) => void;
}) {
  const q = board?.quotes || [];
  if (!q.length) return null;
  const gainer = [...q].sort((a, b) => b.deltaPct - a.deltaPct)[0];
  const loser = [...q].sort((a, b) => a.deltaPct - b.deltaPct)[0];
  const volatile = [...q].sort((a, b) => b.volatility - a.volatility)[0];
  const ath = q.find((x) => x.atHigh) || gainer;
  const items = [
    {
      label: "Maior alta",
      q: gainer,
      icon: TrendingUp,
      tone: "up" as const,
    },
    {
      label: "Maior baixa",
      q: loser,
      icon: TrendingDown,
      tone: "down" as const,
    },
    { label: "Mais volátil", q: volatile, icon: Activity, tone: "flat" as const },
    { label: "No ATH", q: ath, icon: Star, tone: "up" as const },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) =>
        it.q ? (
          <button
            key={it.label}
            type="button"
            onClick={() => onPick(it.q!.id)}
            className={cn(
              cardClass,
              "flex min-h-[96px] flex-col justify-between px-4 py-3.5 text-left transition duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
            )}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
              <it.icon className="h-3.5 w-3.5 opacity-70" />
              {it.label}
            </div>
            <div>
              <div className="truncate text-[15px] font-semibold text-zinc-800 dark:text-zinc-100">
                <span className="mr-1.5 text-base">{it.q.emoji}</span>
                {it.q.name}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    it.tone === "up" && "text-emerald-600 dark:text-emerald-400",
                    it.tone === "down" && "text-red-500 dark:text-red-400",
                    it.tone === "flat" && "text-zinc-500"
                  )}
                >
                  {formatPct(it.q.deltaPct)}
                </span>
                <span className="text-[13px] tabular-nums text-zinc-500 dark:text-zinc-500">
                  {formatCoins(it.q.price)}
                </span>
              </div>
            </div>
          </button>
        ) : null
      )}
    </div>
  );
}

function MarketHeatmap({
  quotes,
  selected,
  onPick,
}: {
  quotes: BolsaQuote[];
  selected: string;
  onPick: (id: string) => void;
}) {
  if (!quotes.length) return null;
  const maxCap = Math.max(...quotes.map((q) => q.price * (1 + q.risk)), 1);

  return (
    <div className={cn(cardClass, "p-3")}>
      <div className="beco-mark mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
        Heatmap
      </div>
      <div className="flex min-h-[120px] flex-wrap content-stretch gap-1.5">
        {quotes.map((q) => {
          const weight = (q.price * (1 + q.risk)) / maxCap;
          const basis = 28 + weight * 42;
          const up = q.deltaPct > 0;
          const down = q.deltaPct < 0;
          const intensity = Math.min(1, Math.abs(q.deltaPct) / 10);
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onPick(q.id)}
              title={`${q.name} ${formatPct(q.deltaPct)}`}
              className={cn(
                "flex min-h-[4.25rem] flex-col items-center justify-center rounded-lg border px-1 py-2 text-center transition active:scale-[0.98]",
                selected === q.id &&
                  "ring-2 ring-emerald-500/40 dark:ring-emerald-400/35",
                !up &&
                  !down &&
                  "border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/80"
              )}
              style={{
                flexGrow: weight * 4,
                flexBasis: `${basis}%`,
                minWidth: "30%",
                ...(up || down
                  ? {
                      backgroundColor: up
                        ? `rgba(16, 185, 129, ${0.1 + intensity * 0.4})`
                        : `rgba(239, 68, 68, ${0.1 + intensity * 0.4})`,
                      borderColor: up
                        ? "rgba(16, 185, 129, 0.35)"
                        : "rgba(239, 68, 68, 0.35)",
                    }
                  : undefined),
              }}
            >
              <span className="text-sm">{q.emoji}</span>
              <span className="mt-0.5 max-w-full truncate px-0.5 text-[10px] font-medium text-zinc-700 dark:text-zinc-300">
                {q.name}
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold tabular-nums",
                  up && "text-emerald-700 dark:text-emerald-400",
                  down && "text-red-600 dark:text-red-400",
                  !up && !down && "text-zinc-500"
                )}
              >
                {formatPct(q.deltaPct)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewsCardCompact({
  event,
  quotes,
  onOpen,
}: {
  event: BolsaEvent;
  quotes: BolsaQuote[];
  onOpen: () => void;
}) {
  const stars = impactStars(event.impactPct);
  const affects = newsAffects(event, quotes);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-xl border border-zinc-200/70 px-3 py-2.5 text-left transition",
        "hover:border-zinc-300 hover:bg-zinc-50/80 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[13px] font-semibold leading-snug text-zinc-800 dark:text-zinc-100">
          {event.title}
        </div>
        <span
          className={cn(
            "shrink-0 text-[12px] font-semibold tabular-nums",
            event.impactPct > 0 && "text-emerald-600 dark:text-emerald-400",
            event.impactPct < 0 && "text-red-500 dark:text-red-400",
            event.impactPct === 0 && "text-zinc-500"
          )}
        >
          {formatPct(event.impactPct, 0)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-500 dark:text-zinc-500">
        <span className="text-amber-600/90 dark:text-amber-400/90">
          {"★".repeat(stars)}
          <span className="opacity-40">{"☆".repeat(Math.max(0, 5 - stars))}</span>
        </span>
        {affects[0] ? (
          <span>
            {affects[0].emoji} {affects[0].name}
          </span>
        ) : null}
        <span>{formatWhen(event.createdAt)}</span>
      </div>
    </button>
  );
}
