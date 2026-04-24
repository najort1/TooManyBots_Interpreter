import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { panelClass } from '../../lib/uiTokens';
import type { BroadcastContact, SurveyFilters, SurveyTypeDefinition } from '../../types';
import { fetchBroadcastContacts } from '../../lib/api';
import {
  createSurveyDefinition,
  duplicateSurveyDefinition,
  fetchSurveyTypes,
  postRefreshSurveyMetricsCache,
  setSurveyDefinitionStatus,
  updateSurveyDefinition,
} from '../../lib/surveyApi';
import { useSurveyData } from '../../hooks/useSurveyData';
import { useSurveyRealtime } from '../../hooks/useSurveyRealtime';
import { useSurveyExport } from '../../hooks/useSurveyExport';
import { SurveyKpiCards } from './SurveyKpiCards';
import { SurveyFilters as SurveyFiltersPanel } from './SurveyFilters';
import { SurveyTrendChart } from './SurveyTrendChart';
import { SurveyDistributionChart } from './SurveyDistributionChart';
import { SurveyComparisonChart } from './SurveyComparisonChart';
import { SurveyFlowBreakdown } from './SurveyFlowBreakdown';
import { SurveyResponseTable } from './SurveyResponseTable';
import { SurveyEmptyState } from './SurveyEmptyState';
import { SurveyEditorView } from './editor/SurveyEditorView';
import { SurveyBroadcastView } from './SurveyBroadcastView';

function lastDays(days: number) {
  const now = Date.now();
  return {
    from: now - (days * 24 * 60 * 60 * 1000),
    to: now,
  };
}

type SurveyTab = 'analytics' | 'manage' | 'broadcast';

function normalizeSurveyTab(value: string | null): SurveyTab {
  return value === 'manage' || value === 'broadcast' ? value : 'analytics';
}

function parseFiniteNumber(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function SurveyView({ onShowNotice }: { onShowNotice: (message: string) => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeSurveyTab(searchParams.get('tab'));
  const [editingSurvey, setEditingSurvey] = useState<SurveyTypeDefinition | null>(null);
  const [creatingSurvey, setCreatingSurvey] = useState(false);
  const [savingSurvey, setSavingSurvey] = useState(false);
  const [managedTypes, setManagedTypes] = useState<SurveyTypeDefinition[]>([]);
  const [loadingManagedTypes, setLoadingManagedTypes] = useState(false);
  const [broadcastContacts, setBroadcastContacts] = useState<BroadcastContact[]>([]);
  const [loadingBroadcastContacts, setLoadingBroadcastContacts] = useState(false);
  const defaults = useMemo(() => lastDays(30), []);
  const filters = useMemo<SurveyFilters>(() => ({
    typeId: String(searchParams.get('typeId') || ''),
    flowPath: String(searchParams.get('flowPath') || ''),
    from: parseFiniteNumber(searchParams.get('from'), defaults.from),
    to: parseFiniteNumber(searchParams.get('to'), defaults.to),
    granularity: String(searchParams.get('granularity') || 'day'),
    limit: Math.max(1, Math.floor(parseFiniteNumber(searchParams.get('limit'), 20))),
    offset: Math.max(0, Math.floor(parseFiniteNumber(searchParams.get('offset'), 0))),
  }), [defaults.from, defaults.to, searchParams]);

  const { exportCsv, exportJson } = useSurveyExport(filters);

  const {
    loading,
    error,
    types,
    overview,
    trend,
    distribution,
    byFlow,
    instances,
    refresh,
  } = useSurveyData({
    filters,
    enabled: true,
    pollMs: 30000,
  });

  useSurveyRealtime(() => {
    void refresh();
  }, { enabled: true, debounceMs: 500 });

  const updateFilters = useCallback((patch: Partial<SurveyFilters>) => {
    const nextFilters = {
      ...filters,
      ...patch,
      offset: 0,
    };

    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      const entries: Array<[keyof SurveyFilters, unknown]> = [
        ['typeId', nextFilters.typeId],
        ['flowPath', nextFilters.flowPath],
        ['from', nextFilters.from],
        ['to', nextFilters.to],
        ['granularity', nextFilters.granularity],
        ['limit', nextFilters.limit],
        ['offset', nextFilters.offset],
      ];

      for (const [key, value] of entries) {
        const normalized = value === null || value === undefined ? '' : String(value).trim();
        if (normalized) {
          next.set(key, normalized);
        } else {
          next.delete(key);
        }
      }

      return next;
    }, { replace: true });
  }, [filters, setSearchParams]);

  const setTab = useCallback((nextTab: SurveyTab) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (nextTab === 'analytics') {
        next.delete('tab');
      } else {
        next.set('tab', nextTab);
      }
      return next;
    });
  }, [setSearchParams]);

  const loadManagedTypes = useCallback(async () => {
    setLoadingManagedTypes(true);
    try {
      setManagedTypes(await fetchSurveyTypes(false));
    } catch (error) {
      onShowNotice(`Falha ao carregar pesquisas cadastradas: ${String((error as Error)?.message || error)}`);
    } finally {
      setLoadingManagedTypes(false);
    }
  }, [onShowNotice]);

  const handleRefreshCache = useCallback(async () => {
    const result = await postRefreshSurveyMetricsCache(filters);
    if (!result.ok) {
      onShowNotice(`Falha ao recalcular cache de pesquisas: ${result.error || 'erro desconhecido'}`);
      return;
    }
    onShowNotice('Cache de pesquisas recalculado com sucesso.');
    await refresh();
  }, [filters, onShowNotice, refresh]);

  const loadBroadcastContacts = useCallback(async () => {
    setLoadingBroadcastContacts(true);
    try {
      const contacts = await fetchBroadcastContacts('', 1000);
      setBroadcastContacts(contacts);
    } catch (error) {
      onShowNotice(`Falha ao carregar contatos para pesquisa: ${String((error as Error)?.message || error)}`);
    } finally {
      setLoadingBroadcastContacts(false);
    }
  }, [onShowNotice]);

  const handleSaveSurvey = useCallback(async (payload: Parameters<typeof createSurveyDefinition>[0]) => {
    setSavingSurvey(true);
    try {
      if (editingSurvey?.typeId) {
        await updateSurveyDefinition(editingSurvey.typeId, payload);
        onShowNotice('Pesquisa atualizada.');
      } else {
        await createSurveyDefinition(payload);
        onShowNotice('Pesquisa criada.');
      }
      setEditingSurvey(null);
      setCreatingSurvey(false);
      await loadManagedTypes();
      await refresh();
    } catch (error) {
      onShowNotice(`Falha ao salvar pesquisa: ${String((error as Error)?.message || error)}`);
    } finally {
      setSavingSurvey(false);
    }
  }, [editingSurvey, loadManagedTypes, onShowNotice, refresh]);

  const handleDuplicate = useCallback(async (typeId: string) => {
    try {
      await duplicateSurveyDefinition(typeId);
      onShowNotice('Pesquisa duplicada como rascunho.');
      await loadManagedTypes();
      await refresh();
    } catch (error) {
      onShowNotice(`Falha ao duplicar pesquisa: ${String((error as Error)?.message || error)}`);
    }
  }, [loadManagedTypes, onShowNotice, refresh]);

  const handleStatus = useCallback(async (typeId: string, status: 'active' | 'inactive') => {
    try {
      await setSurveyDefinitionStatus(typeId, status);
      onShowNotice(status === 'active' ? 'Pesquisa ativada.' : 'Pesquisa desativada.');
      await loadManagedTypes();
      await refresh();
    } catch (error) {
      onShowNotice(`Falha ao alterar status: ${String((error as Error)?.message || error)}`);
    }
  }, [loadManagedTypes, onShowNotice, refresh]);

  const shouldShowEmpty = !loading && !error && Number(overview.totalInstances || 0) === 0;

  const managementRows = managedTypes.length > 0 ? managedTypes : types;

  return (
    <section className="mx-auto max-w-[1560px] space-y-4">
      <div className={`${panelClass} flex flex-wrap gap-2`}>
        {[
          { id: 'analytics', label: 'Analytics' },
          { id: 'manage', label: 'Gerenciar' },
          { id: 'broadcast', label: 'Disparo manual' },
        ].map(item => (
          <button
            key={item.id}
            type="button"
            className={[
              'h-9 rounded-xl px-3 text-sm font-semibold transition',
              tab === item.id ? 'bg-[#1e63c9] text-white' : 'bg-white text-slate-700 hover:bg-slate-50',
            ].join(' ')}
            onClick={() => {
              setTab(item.id as 'analytics' | 'manage' | 'broadcast');
              if (item.id === 'manage') {
                void loadManagedTypes();
              }
              if (item.id === 'broadcast' && broadcastContacts.length === 0) {
                void loadBroadcastContacts();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'manage' ? (
        creatingSurvey || editingSurvey ? (
          <SurveyEditorView
            survey={editingSurvey}
            busy={savingSurvey}
            onSave={payload => {
              void handleSaveSurvey(payload);
            }}
            onCancel={() => {
              setCreatingSurvey(false);
              setEditingSurvey(null);
            }}
          />
        ) : (
          <article className={panelClass}>
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-extrabold">Pesquisas</h3>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#174d9d] bg-[#1e63c9] px-3 text-[0.78rem] font-semibold text-white transition hover:bg-[#174d9d]"
                onClick={() => setCreatingSurvey(true)}
              >
                <i className="fa-solid fa-plus" aria-hidden="true" />
                Nova pesquisa
              </button>
            </header>
            <div className="overflow-auto rounded-xl border border-[#dce6f3]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[#f8fbff] text-left text-xs uppercase tracking-[0.06em] text-slate-500">
                  <tr>
                    <th className="p-3">Nome</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Perguntas</th>
                    <th className="p-3">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingManagedTypes ? (
                    <tr>
                      <td className="p-3 text-sm text-slate-500" colSpan={4}>Carregando pesquisas...</td>
                    </tr>
                  ) : null}
                  {managementRows.map(survey => {
                    const status = String(survey.status || (survey.isActive ? 'active' : 'inactive'));
                    const questions = Array.isArray(survey.questions) ? survey.questions : (survey.schema.questions || []);
                    return (
                      <tr key={survey.typeId} className="border-t border-[#edf2f8]">
                        <td className="p-3 font-semibold text-slate-700">{survey.name}</td>
                        <td className="p-3">{status}</td>
                        <td className="p-3">{questions.length}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <button className="rounded-lg border border-[#d4e0f1] px-2 py-1 text-xs" onClick={() => setEditingSurvey(survey)}>Editar</button>
                            <button className="rounded-lg border border-[#d4e0f1] px-2 py-1 text-xs" onClick={() => void handleDuplicate(survey.typeId)}>Duplicar</button>
                            <button
                              className="rounded-lg border border-[#d4e0f1] px-2 py-1 text-xs"
                              onClick={() => void handleStatus(survey.typeId, survey.isActive ? 'inactive' : 'active')}
                            >
                              {survey.isActive ? 'Desativar' : 'Ativar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        )
      ) : null}

      {tab === 'broadcast' ? (
        <SurveyBroadcastView
          surveys={types}
          contacts={broadcastContacts}
          loadingContacts={loadingBroadcastContacts}
          onRefreshContacts={() => {
            void loadBroadcastContacts();
          }}
          onShowNotice={onShowNotice}
        />
      ) : null}

      {tab === 'analytics' ? (
        <>
      <SurveyFiltersPanel
        types={types}
        filters={filters}
        busy={loading}
        onChange={updateFilters}
        onRefresh={() => {
          void refresh();
        }}
        onExportCsv={exportCsv}
        onExportJson={() => {
          void exportJson().catch(err => {
            onShowNotice(`Falha ao exportar JSON de pesquisas: ${String((err as Error)?.message || err)}`);
          });
        }}
        onRefreshCache={() => {
          void handleRefreshCache();
        }}
      />

      {error ? (
        <article className={`${panelClass} border-red-200 bg-red-50 text-red-700`}>
          Falha ao carregar dashboard de pesquisas: {error}
        </article>
      ) : null}

      {shouldShowEmpty ? (
        <SurveyEmptyState />
      ) : (
        <>
          <SurveyKpiCards overview={overview} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SurveyTrendChart trend={trend} />
            <SurveyComparisonChart overview={overview} />
            <SurveyDistributionChart distribution={distribution} />
            <SurveyFlowBreakdown byFlow={byFlow} />
          </div>

          <SurveyResponseTable instances={instances} loading={loading} />
        </>
      )}
        </>
      ) : null}
    </section>
  );
}
