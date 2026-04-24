import { panelClass } from '../../lib/uiTokens';
import type { SurveyInstanceList } from '../../types';

function fmtDateTime(value: number | null) {
  if (!value) return '--';
  return new Date(value).toLocaleString('pt-BR');
}

function inferStatus(row: {
  completedAt: number | null;
  abandonedAt: number | null;
}) {
  if (row.completedAt) return 'concluida';
  if (row.abandonedAt) return 'abandonada';
  return 'pendente';
}

export function SurveyResponseTable({
  instances,
  loading,
}: {
  instances: SurveyInstanceList;
  loading: boolean;
}) {
  return (
    <article className={panelClass}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
          <i className="fa-regular fa-table-list text-[#2f5f9f]" aria-hidden="true" />
          Respostas recentes
        </h3>
        <span className="text-xs text-slate-500">
          Total: {instances.total}
        </span>
      </header>

      <div className="max-h-[360px] overflow-auto rounded-xl border border-[#e1eaf6] bg-[#f6f9ff]">
        <table className="w-full border-collapse text-[0.78rem]">
          <thead>
            <tr>
              <th className="border-b border-[#e1eaf6] p-2 text-left font-bold text-slate-500">Inicio</th>
              <th className="border-b border-[#e1eaf6] p-2 text-left font-bold text-slate-500">Tipo</th>
              <th className="border-b border-[#e1eaf6] p-2 text-left font-bold text-slate-500">Flow</th>
              <th className="border-b border-[#e1eaf6] p-2 text-left font-bold text-slate-500">JID</th>
              <th className="border-b border-[#e1eaf6] p-2 text-left font-bold text-slate-500">Status</th>
              <th className="border-b border-[#e1eaf6] p-2 text-left font-bold text-slate-500">Fim</th>
            </tr>
          </thead>
          <tbody>
            {instances.items.map(item => {
              const status = inferStatus(item);
              return (
                <tr key={item.instanceId}>
                  <td className="border-b border-[#e9f0fa] p-2">{fmtDateTime(item.startedAt)}</td>
                  <td className="border-b border-[#e9f0fa] p-2">{item.surveyTypeId}</td>
                  <td className="border-b border-[#e9f0fa] p-2">{item.flowPath || '--'}</td>
                  <td className="border-b border-[#e9f0fa] p-2">{item.jid}</td>
                  <td className="border-b border-[#e9f0fa] p-2">{status}</td>
                  <td className="border-b border-[#e9f0fa] p-2">{fmtDateTime(item.completedAt || item.abandonedAt)}</td>
                </tr>
              );
            })}
            {!loading && instances.items.length === 0 ? (
              <tr>
                <td className="p-3 text-center text-slate-500" colSpan={6}>Nenhuma resposta encontrada para os filtros.</td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td className="p-3 text-center text-slate-500" colSpan={6}>Carregando pesquisas...</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}
