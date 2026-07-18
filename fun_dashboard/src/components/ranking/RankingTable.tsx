import { displayPlayer, formatNumber } from "@/lib/format";
import type { RankEntry } from "@/lib/types";

type Props = {
  entries: RankEntry[];
  kind: "xp" | "coins" | "messages" | "casino";
  empty?: string;
};

export function RankingTable({ entries, kind, empty = "Nada por aqui ainda." }: Props) {
  if (!entries.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        {empty}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-100 bg-zinc-50/80 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2.5 font-medium">#</th>
            <th className="px-3 py-2.5 font-medium">Jogador</th>
            {kind === "xp" && (
              <>
                <th className="px-3 py-2.5 font-medium">Lv</th>
                <th className="px-3 py-2.5 font-medium">XP</th>
                <th className="px-3 py-2.5 font-medium">Coins</th>
              </>
            )}
            {kind === "coins" && (
              <th className="px-3 py-2.5 font-medium">Coins</th>
            )}
            {kind === "messages" && (
              <th className="px-3 py-2.5 font-medium">Msgs</th>
            )}
            {kind === "casino" && (
              <>
                <th className="px-3 py-2.5 font-medium">Lucro</th>
                <th className="px-3 py-2.5 font-medium">Apostado</th>
                <th className="px-3 py-2.5 font-medium">Jogos</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {entries.map((row) => (
            <tr
              key={`${row.rank}-${row.userJid}`}
              className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50"
            >
              <td className="px-3 py-2.5 tabular-nums text-zinc-500 dark:text-zinc-400">
                {row.rank}
              </td>
              <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                {displayPlayer(row)}
              </td>
              {kind === "xp" && (
                <>
                  <td className="px-3 py-2.5 tabular-nums dark:text-zinc-300">
                    {row.level ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums dark:text-zinc-300">
                    {formatNumber(row.xp)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums dark:text-zinc-300">
                    {formatNumber(row.coins)}
                  </td>
                </>
              )}
              {kind === "coins" && (
                <td className="px-3 py-2.5 tabular-nums font-medium dark:text-zinc-100">
                  {formatNumber(row.coins)}
                </td>
              )}
              {kind === "messages" && (
                <td className="px-3 py-2.5 tabular-nums dark:text-zinc-300">
                  {formatNumber(row.messageCount)}
                </td>
              )}
              {kind === "casino" && (
                <>
                  <td
                    className={`px-3 py-2.5 tabular-nums font-medium ${
                      (row.profit || 0) >= 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {(row.profit || 0) >= 0 ? "+" : ""}
                    {formatNumber(row.profit)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums dark:text-zinc-300">
                    {formatNumber(row.wagered)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums dark:text-zinc-300">
                    {formatNumber(row.games)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
