import { useMemo, useState } from 'react';
import { buttonBaseClass, inputBaseClass, panelClass, timelineItemClass } from '../../lib/uiTokens';
import { broadcastSurvey } from '../../lib/surveyApi';
import type { BroadcastContact, SurveyBroadcastResult, SurveyTypeDefinition } from '../../types';
import { formatJidPhone } from '../../lib/format';

interface SurveyBroadcastViewProps {
  surveys: SurveyTypeDefinition[];
  contacts: BroadcastContact[];
  loadingContacts: boolean;
  onRefreshContacts: () => void;
  onShowNotice: (message: string) => void;
}

export function SurveyBroadcastView({
  surveys,
  contacts,
  loadingContacts,
  onRefreshContacts,
  onShowNotice,
}: SurveyBroadcastViewProps) {
  const [surveyTypeId, setSurveyTypeId] = useState('');
  const [selectedJids, setSelectedJids] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SurveyBroadcastResult | null>(null);

  const individualContacts = useMemo(
    () => contacts.filter(contact => contact.recipientType !== 'group'),
    [contacts]
  );
  const blockedGroupsCount = Math.max(0, contacts.length - individualContacts.length);
  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return individualContacts;
    return individualContacts.filter(contact => (
      String(contact.jid || '').toLowerCase().includes(normalized)
      || String(contact.name || '').toLowerCase().includes(normalized)
    ));
  }, [individualContacts, search]);
  const selected = useMemo(() => new Set(selectedJids), [selectedJids]);

  const toggle = (jid: string) => {
    setSelectedJids(previous => (
      previous.includes(jid) ? previous.filter(item => item !== jid) : [...previous, jid]
    ));
  };

  const handleSend = async () => {
    if (!surveyTypeId || selectedJids.length === 0) {
      onShowNotice('Selecione uma pesquisa e ao menos um contato individual.');
      return;
    }
    setBusy(true);
    setLastResult(null);
    try {
      const result = await broadcastSurvey(surveyTypeId, selectedJids);
      setLastResult(result);
      onShowNotice(`Pesquisa enviada: ${result.sent}/${result.attempted} contato(s).`);
      if (result.failed === 0) setSelectedJids([]);
    } catch (error) {
      onShowNotice(`Falha ao enviar pesquisa: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`${panelClass} grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,460px)_1fr]`}>
      <section className="min-w-0">
        <header className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-extrabold">Disparo manual</h3>
            <small className="text-xs text-slate-500">
              Apenas contatos individuais entram na selecao. Grupos filtrados: {blockedGroupsCount}
            </small>
          </div>
          <button
            type="button"
            className={`${buttonBaseClass} border-[#d4e0f1] bg-white text-slate-700 hover:bg-slate-50`}
            onClick={onRefreshContacts}
            disabled={loadingContacts || busy}
          >
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
            Atualizar
          </button>
        </header>

        <select
          value={surveyTypeId}
          onChange={event => setSurveyTypeId(event.target.value)}
          className={`${inputBaseClass} mb-2 w-full`}
          disabled={busy}
        >
          <option value="">Selecione a pesquisa</option>
          {surveys.filter(survey => survey.isActive !== false).map(survey => (
            <option key={survey.typeId} value={survey.typeId}>{survey.name}</option>
          ))}
        </select>

        <input
          type="text"
          value={search}
          onChange={event => setSearch(event.target.value)}
          className={`${inputBaseClass} mb-2 w-full`}
          placeholder="Buscar contato"
          disabled={busy}
        />

        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={`${buttonBaseClass} border-[#d4e0f1] bg-white text-slate-700 hover:bg-slate-50`}
            onClick={() => setSelectedJids([...new Set([...selectedJids, ...filtered.map(item => item.jid)])])}
            disabled={filtered.length === 0 || busy}
          >
            Selecionar lista
          </button>
          <button
            type="button"
            className={`${buttonBaseClass} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
            onClick={() => setSelectedJids([])}
            disabled={selectedJids.length === 0 || busy}
          >
            Limpar
          </button>
        </div>

        <div className="max-h-[420px] overflow-auto rounded-xl border border-[#dce6f3] bg-[#eef3fb] p-3">
          {loadingContacts ? (
            <p className="py-4 text-center text-sm text-slate-500">Carregando contatos...</p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Nenhum contato individual encontrado.</p>
          ) : filtered.map(contact => (
            <label key={contact.jid} className={`mb-2 flex cursor-pointer gap-2 ${timelineItemClass} last:mb-0`}>
              <input
                type="checkbox"
                checked={selected.has(contact.jid)}
                onChange={() => toggle(contact.jid)}
                disabled={busy}
                className="mt-1"
              />
              <span className="min-w-0">
                <strong className="block truncate text-sm">{contact.name || formatJidPhone(contact.jid)}</strong>
                <small className="block truncate text-xs text-slate-500">{contact.jid}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="min-w-0">
        <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-4">
          <p className="m-0 text-sm font-semibold text-slate-700">
            Selecionados: {selectedJids.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            O intervalo minimo de envio e 250 ms por contato, aplicado no backend.
          </p>
          <button
            type="button"
            className={`${buttonBaseClass} mt-3 border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
            onClick={handleSend}
            disabled={busy || !surveyTypeId || selectedJids.length === 0}
          >
            <i className={busy ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-paper-plane'} aria-hidden="true" />
            {busy ? 'Enviando...' : 'Enviar pesquisa'}
          </button>
        </div>

        {lastResult ? (
          <div className="mt-3 rounded-xl border border-[#dce6f3] bg-white p-4">
            <p className="m-0 text-sm font-semibold text-slate-700">
              Resultado: {lastResult.sent}/{lastResult.attempted} enviados
            </p>
            <small className="block text-xs text-slate-500">Falhas: {lastResult.failed}</small>
          </div>
        ) : null}
      </section>
    </article>
  );
}
