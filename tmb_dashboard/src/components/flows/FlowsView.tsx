import { useEffect, useState, useMemo } from 'react';
import { fetchBots } from '../../lib/api';
import { panelClass, inputBaseClass } from '../../lib/uiTokens';
import { KpiCard } from '../KpiCard';
import type { BotInfo } from '../../types';

interface FlowsViewProps {
  onShowNotice?: (msg: string) => void;
}

export function FlowsView({ onShowNotice }: FlowsViewProps) {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const loadBotsData = async () => {
    setIsLoading(true);
    try {
      const data = await fetchBots();
      setBots(data || []);
    } catch (err) {
      if (onShowNotice) {
        onShowNotice(`Erro ao carregar fluxos: ${String((err as Error)?.message || err)}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBotsData();
  }, []);

  const filteredBots = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return bots.filter(
      b => b.fileName.toLowerCase().includes(q) || b.flowPath.toLowerCase().includes(q)
    );
  }, [bots, searchQuery]);

  const activeCount = bots.filter(b => b.status === 'active').length;
  const errorCount = bots.filter(b => b.status === 'error').length;
  const inactiveCount = bots.filter(b => b.status === 'inactive').length;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-6 pb-20 md:px-10">

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard title="Total" value={bots.length} icon="fa-solid fa-file-code" color="blue" />
        <KpiCard title="Ativos" value={activeCount} icon="fa-solid fa-play" color="emerald" />
        <KpiCard title="Inativos" value={inactiveCount} icon="fa-solid fa-pause" color="slate" />
        <KpiCard title="Com Erros" value={errorCount} icon="fa-solid fa-triangle-exclamation" color="red" />
      </div>

      <div className={panelClass}>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-base font-bold text-slate-800">Arquivos de Fluxo</h2>
          <div className="relative w-full max-w-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 pl-3 flex items-center">
              <i className="fa-solid fa-search text-gray-400"></i>
            </div>
            <input
              type="text"
              placeholder="Buscar fluxos..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className={[inputBaseClass, 'w-full pl-9'].join(' ')}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-slate-500 text-sm font-semibold gap-2">
            <i className="fa-solid fa-spinner animate-spin" /> Carregando...
          </div>
        ) : filteredBots.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-slate-500 gap-2">
            <i className="fa-solid fa-folder-open text-2xl text-gray-300" />
            <p className="text-sm font-medium">Nenhum fluxo encontrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-100 text-slate-500">
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[0.70rem]">Status</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[0.70rem]">Arquivo</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[0.70rem]">Tipo</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[0.70rem]">Blocos</th>
                  <th className="py-3 px-4 font-semibold uppercase tracking-wider text-[0.70rem]">Saúde da Sintaxe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBots.map(bot => {
                  let statusColor = 'bg-gray-100 text-gray-600';
                  let statusText = 'Inativo';
                  if (bot.status === 'active') {
                    statusColor = 'bg-emerald-100 text-emerald-700 border-emerald-200 border';
                    statusText = 'Ativo';
                  } else if (bot.status === 'error') {
                    statusColor = 'bg-red-100 text-red-700 border-red-200 border';
                    statusText = 'Erro';
                  }

                  let typeIcon = 'fa-solid fa-shapes';
                  if (bot.botType === 'conversation') typeIcon = 'fa-solid fa-comments';
                  if (bot.botType === 'command') typeIcon = 'fa-solid fa-terminal';

                  return (
                    <tr key={bot.flowPath} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${statusColor}`}>
                          {statusText}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-800 flex items-center gap-2">
                          <i className="fa-regular fa-file-code text-indigo-400" />
                          {bot.fileName}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs" title={bot.flowPath}>
                          {bot.flowPath}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-slate-600 font-medium capitalize">
                          <i className={`${typeIcon} w-4 text-center text-gray-400`} />
                          {bot.botType}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700">
                        {bot.totalBlocks}
                      </td>
                      <td className="py-3 px-4">
                        {bot.syntaxValid ? (
                          <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-xs">
                            <i className="fa-solid fa-check-circle" /> Válido
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 max-w-sm">
                            <div className="flex items-center gap-1.5 text-red-600 font-medium text-xs">
                              <i className="fa-solid fa-xmark-circle" /> Falha na análise JSON ou sintaxe
                            </div>
                            <div className="text-[10px] bg-red-50 text-red-800 p-1.5 rounded border border-red-100 truncate w-full" title={bot.syntaxError || 'Unknown Error'}>
                              {bot.syntaxError}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
