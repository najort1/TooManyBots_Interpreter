import { buttonBaseClass, inputBaseClass, panelClass } from '../../lib/uiTokens';
import type { SurveyFilters, SurveyTypeDefinition } from '../../types';

function toDateInputValue(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromDateInputValue(value: string): number | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

interface SurveyFiltersProps {
  types: SurveyTypeDefinition[];
  filters: SurveyFilters;
  busy: boolean;
  onChange: (patch: Partial<SurveyFilters>) => void;
  onRefresh: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onRefreshCache: () => void;
}

export function SurveyFilters({
  types,
  filters,
  busy,
  onChange,
  onRefresh,
  onExportCsv,
  onExportJson,
  onRefreshCache,
}: SurveyFiltersProps) {
  const fromValue = toDateInputValue(filters.from ?? null);
  const toValue = toDateInputValue(filters.to ?? null);

  return (
    <section className={[panelClass, 'space-y-3'].join(' ')}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Tipo</span>
          <select
            className={inputBaseClass}
            value={String(filters.typeId || '')}
            onChange={event => onChange({ typeId: event.target.value })}
          >
            <option value="">Todos</option>
            {types.map(type => (
              <option key={type.typeId} value={type.typeId}>{type.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Granularidade</span>
          <select
            className={inputBaseClass}
            value={String(filters.granularity || 'day')}
            onChange={event => onChange({ granularity: event.target.value })}
          >
            <option value="hour">Hora</option>
            <option value="day">Dia</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">De</span>
          <input
            type="date"
            className={inputBaseClass}
            value={fromValue}
            onChange={event => onChange({ from: fromDateInputValue(event.target.value) })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Ate</span>
          <input
            type="date"
            className={inputBaseClass}
            value={toValue}
            onChange={event => onChange({ to: fromDateInputValue(event.target.value) })}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${buttonBaseClass} border-[#cde0f8] bg-[#edf5ff] text-[#214c84]`}
          onClick={onRefresh}
          disabled={busy}
        >
          <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-rotate'}`} aria-hidden="true" />
          {busy ? 'Atualizando...' : 'Atualizar'}
        </button>
        <button type="button" className={`${buttonBaseClass} border-[#d3dfef] bg-white text-slate-700`} onClick={onExportCsv}>
          <i className="fa-solid fa-file-csv" aria-hidden="true" /> Exportar CSV
        </button>
        <button type="button" className={`${buttonBaseClass} border-[#d3dfef] bg-white text-slate-700`} onClick={onExportJson}>
          <i className="fa-solid fa-file-code" aria-hidden="true" /> Exportar JSON
        </button>
        <button
          type="button"
          className={`${buttonBaseClass} border-[#f0d7a8] bg-[#fff7e8] text-[#8a5a10]`}
          onClick={onRefreshCache}
          disabled={busy}
        >
          <i className="fa-solid fa-bolt" aria-hidden="true" /> Recalcular cache
        </button>
      </div>
    </section>
  );
}
