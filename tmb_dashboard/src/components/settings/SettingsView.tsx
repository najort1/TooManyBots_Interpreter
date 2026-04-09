import type { DatabaseInfo } from '../../types';

interface SettingsViewProps {
  autoReloadFlows: boolean;
  theme: 'light' | 'dark';
  dbInfo: DatabaseInfo | null;
  busySaveSettings: boolean;
  busyClearCache: boolean;
  busyRefreshDb: boolean;
  onToggleAutoReload: (value: boolean) => void;
  onToggleTheme: (value: 'light' | 'dark') => void;
  onClearCache: () => void;
  onRefreshDbInfo: () => void;
}

const panel = 'rounded-2xl border border-[#d8e2ef] bg-white p-4 shadow-[0_10px_32px_rgba(18,32,51,0.08)]';
const buttonBase =
  'inline-flex h-9 items-center justify-center rounded-full border px-3 text-[0.78rem] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';

function formatBytes(value: number) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function SettingsView({
  autoReloadFlows,
  theme,
  dbInfo,
  busySaveSettings,
  busyClearCache,
  busyRefreshDb,
  onToggleAutoReload,
  onToggleTheme,
  onClearCache,
  onRefreshDbInfo,
}: SettingsViewProps) {
  return (
    <section className="mx-auto grid max-w-[1560px] grid-cols-1 gap-4 xl:grid-cols-2">
      <article className={panel}>
        <header className="mb-3">
          <h3 className="text-base font-extrabold">Runtime</h3>
        </header>

        <div className="space-y-3">
          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Auto-reload de flows (.tmb)</p>
            <small className="text-xs text-slate-500">
              Atualiza automaticamente o flow ao detectar mudanças em arquivos.
            </small>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBase,
                  autoReloadFlows ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={busySaveSettings}
                onClick={() => onToggleAutoReload(true)}
              >
                Habilitado
              </button>
              <button
                type="button"
                className={[
                  buttonBase,
                  !autoReloadFlows ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={busySaveSettings}
                onClick={() => onToggleAutoReload(false)}
              >
                Desabilitado
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Tema</p>
            <small className="text-xs text-slate-500">Alterna entre visual claro e escuro no dashboard.</small>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBase,
                  theme === 'light' ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => onToggleTheme('light')}
              >
                Claro
              </button>
              <button
                type="button"
                className={[
                  buttonBase,
                  theme === 'dark' ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => onToggleTheme('dark')}
              >
                Escuro
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Cache Settings</p>
            <small className="text-xs text-slate-500">
              Limpa cache em memória de sessões/blocos para diagnóstico sem reiniciar.
            </small>
            <div className="mt-2">
              <button
                type="button"
                className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
                onClick={onClearCache}
                disabled={busyClearCache}
              >
                {busyClearCache ? 'Limpando...' : 'Limpar cache runtime'}
              </button>
            </div>
          </div>
        </div>
      </article>

      <article className={panel}>
        <header className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-extrabold">Informações do DB</h3>
          <button
            type="button"
            className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onRefreshDbInfo}
            disabled={busyRefreshDb}
          >
            {busyRefreshDb ? 'Atualizando...' : 'Atualizar'}
          </button>
        </header>

        {!dbInfo ? (
          <p className="text-sm text-slate-500">Sem dados do banco ainda.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
              <strong>Arquivo:</strong> {dbInfo.path}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>Journal:</strong> {dbInfo.journalMode}
              </div>
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>Synchronous:</strong> {dbInfo.synchronous}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>DB:</strong> {formatBytes(dbInfo.fileSizeBytes)}
              </div>
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>WAL:</strong> {formatBytes(dbInfo.walSizeBytes)}
              </div>
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>SHM:</strong> {formatBytes(dbInfo.shmSizeBytes)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>Sessões:</strong> {dbInfo.sessionsTotal} (ativas: {dbInfo.sessionsActive})
              </div>
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>Eventos:</strong> {dbInfo.conversationEventsTotal}
              </div>
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>Conversas:</strong> {dbInfo.conversationSessionsTotal}
              </div>
              <div className="rounded-lg border border-[#dce6f3] bg-[#f8fbff] p-2 text-sm">
                <strong>Broadcast:</strong> {dbInfo.broadcastCampaignsTotal} campanhas / {dbInfo.broadcastRecipientsTotal} destinatários
              </div>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
