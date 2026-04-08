import { useMemo, useRef } from 'react';
import { fmtTime, formatJidPhone } from '../../lib/format';
import type { BroadcastContact, BroadcastSendResult } from '../../types';

interface BroadcastViewProps {
  contacts: BroadcastContact[];
  loadingContacts: boolean;
  recipientMode: 'all' | 'selected';
  selectedJids: string[];
  search: string;
  messageText: string;
  imageFileName: string;
  imagePreviewUrl: string;
  busySend: boolean;
  lastResult: BroadcastSendResult | null;
  onRecipientModeChange: (value: 'all' | 'selected') => void;
  onSearchChange: (value: string) => void;
  onRefreshContacts: () => void;
  onToggleRecipient: (jid: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onMessageChange: (value: string) => void;
  onPickImage: (file: File) => void;
  onClearImage: () => void;
  onSend: () => void;
}

const panel = 'rounded-2xl border border-[#d8e2ef] bg-white p-4 shadow-[0_10px_32px_rgba(18,32,51,0.08)]';
const buttonBase =
  'inline-flex h-9 items-center justify-center rounded-full border px-3 text-[0.78rem] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';

export function BroadcastView({
  contacts,
  loadingContacts,
  recipientMode,
  selectedJids,
  search,
  messageText,
  imageFileName,
  imagePreviewUrl,
  busySend,
  lastResult,
  onRecipientModeChange,
  onSearchChange,
  onRefreshContacts,
  onToggleRecipient,
  onSelectAllVisible,
  onClearSelection,
  onMessageChange,
  onPickImage,
  onClearImage,
  onSend,
}: BroadcastViewProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const selected = useMemo(() => new Set(selectedJids), [selectedJids]);
  const recipientsCount = recipientMode === 'all' ? contacts.length : selectedJids.length;

  return (
    <section className="mx-auto grid max-w-[1560px] grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,460px)_1fr]">
      <article className={`${panel} min-w-0`}>
        <header className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-extrabold">Destinatarios</h3>
          <button
            type="button"
            className={`${buttonBase} w-9 border-[#d4e0f1] bg-white/80 p-0 text-slate-700 hover:bg-slate-50`}
            onClick={onRefreshContacts}
            aria-label="Atualizar contatos"
            title="Atualizar contatos"
          >
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          </button>
        </header>

        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-[#dce6f3] bg-[#f5f9ff] p-2">
          <button
            type="button"
            className={[
              'rounded-lg px-3 py-2 text-sm font-semibold transition',
              recipientMode === 'all' ? 'bg-[#1e63c9] text-white' : 'bg-white text-slate-700 hover:bg-slate-50',
            ].join(' ')}
            onClick={() => onRecipientModeChange('all')}
          >
            Todos ({contacts.length})
          </button>
          <button
            type="button"
            className={[
              'rounded-lg px-3 py-2 text-sm font-semibold transition',
              recipientMode === 'selected' ? 'bg-[#1e63c9] text-white' : 'bg-white text-slate-700 hover:bg-slate-50',
            ].join(' ')}
            onClick={() => onRecipientModeChange('selected')}
          >
            Selecionados ({selectedJids.length})
          </button>
        </div>

        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500" htmlFor="broadcast-search">
          Buscar contato
        </label>
        <input
          id="broadcast-search"
          type="text"
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Filtrar por JID"
          className="mb-3 w-full rounded-[10px] border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
        />

        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onSelectAllVisible}
            disabled={contacts.length === 0}
          >
            Selecionar lista
          </button>
          <button
            type="button"
            className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
            onClick={onClearSelection}
            disabled={selectedJids.length === 0}
          >
            Limpar
          </button>
        </div>

        <div className="max-h-[520px] overflow-auto rounded-xl border border-[#dce6f3] bg-[#eef3fb] p-2">
          {loadingContacts ? (
            <p className="py-4 text-center text-sm text-slate-500">Carregando contatos...</p>
          ) : contacts.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Nenhum contato encontrado.</p>
          ) : (
            contacts.map(contact => (
              <label
                key={contact.jid}
                className="mb-2 flex cursor-pointer items-start gap-2 rounded-[10px] border border-[#dce6f3] bg-white p-2.5 last:mb-0"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[#1e63c9]"
                  checked={selected.has(contact.jid)}
                  onChange={() => onToggleRecipient(contact.jid)}
                />
                <span className="min-w-0 flex-1">
                  <strong className="block text-[0.85rem]">{formatJidPhone(contact.jid)}</strong>
                  <small className="block text-[0.73rem] text-slate-500">
                    Ultima interação: {contact.lastInteractionAt ? fmtTime(contact.lastInteractionAt) : '--:--'}
                  </small>
                  {contact.hasActiveSession ? (
                    <small className="mt-1 inline-block rounded-full bg-[#dcfce7] px-2 py-0.5 text-[0.66rem] font-bold text-[#166534]">
                      Sessao ativa
                    </small>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </div>
      </article>

      <article className={`${panel} min-w-0`}>
        <header className="mb-3">
          <h3 className="text-base font-extrabold">Novo Anuncio</h3>
          <small className="mt-1 block text-xs text-slate-500">
            Destinatarios atuais: {recipientsCount} · modo {recipientMode === 'all' ? 'todos' : 'selecionados'}
          </small>
          {recipientMode === 'all' && search.trim() ? (
            <small className="mt-1 block text-[0.72rem] text-amber-700">
              O filtro de busca nao limita o envio no modo "todos".
            </small>
          ) : null}
        </header>

        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500" htmlFor="broadcast-message">
          Mensagem
        </label>
        <textarea
          id="broadcast-message"
          value={messageText}
          onChange={event => onMessageChange(event.target.value)}
          placeholder="Digite o texto do anuncio (opcional se enviar apenas imagem)"
          className="min-h-[180px] w-full rounded-[10px] border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (!file) return;
              onPickImage(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={() => imageInputRef.current?.click()}
          >
            <i className="fa-regular fa-image" aria-hidden="true" /> Anexar imagem
          </button>
          <button
            type="button"
            className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
            onClick={onClearImage}
            disabled={!imageFileName}
          >
            Remover imagem
          </button>
          <button
            type="button"
            className={`${buttonBase} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
            onClick={onSend}
            disabled={busySend || recipientsCount <= 0}
          >
            <i className={busySend ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-paper-plane'} aria-hidden="true" />{' '}
            {busySend ? 'Enviando...' : 'Enviar anuncio'}
          </button>
        </div>

        {imageFileName ? (
          <div className="mt-3 rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <small className="block text-xs text-slate-500">Imagem selecionada: {imageFileName}</small>
            {imagePreviewUrl ? (
              <img
                src={imagePreviewUrl}
                alt="Preview da imagem de anuncio"
                className="mt-2 max-h-[240px] rounded-[10px] border border-[#d7e3f2] object-contain"
              />
            ) : null}
          </div>
        ) : null}

        {lastResult ? (
          <div className="mt-3 rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">
              Campanha #{lastResult.campaignId}: {lastResult.sent}/{lastResult.attempted} enviados
            </p>
            <small className="block text-xs text-slate-500">Falhas: {lastResult.failed}</small>
          </div>
        ) : null}
      </article>
    </section>
  );
}
