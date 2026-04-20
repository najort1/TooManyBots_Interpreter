import { useMemo, useState } from 'react';
import { buttonBaseClass, inputBaseClass, panelClass } from '../../lib/uiTokens';
import type { BotInfo, RuntimeSetupConfig, SetupTargetsResponse } from '../../types';

interface SetupViewProps {
  needsInitialSetup: boolean;
  bots: BotInfo[];
  setupConfig: RuntimeSetupConfig | null;
  busyLoad: boolean;
  busyTargets: boolean;
  busySave: boolean;
  onReloadBots: () => void;
  onRefreshTargets: () => void;
  onSave: (input: Partial<RuntimeSetupConfig>) => void;
  setupTargets: SetupTargetsResponse | null;
  onShowNotice?: (message: string) => void;
}

function parseTextareaList(value: string): string[] {
  const entries = String(value ?? '')
    .split(/[\r\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return [...new Set(entries)];
}

function parseSelectedFileName(flowPath: string): string {
  const normalized = String(flowPath || '').replace(/\\/g, '/');
  if (!normalized) return '';
  const parts = normalized.split('/');
  return String(parts[parts.length - 1] || '').trim();
}

function toSelectedFilesFromConfig(config: RuntimeSetupConfig): string[] {
  const selected = new Set<string>();
  for (const flowPath of Array.isArray(config.flowPaths) ? config.flowPaths : []) {
    const fileName = parseSelectedFileName(flowPath);
    if (fileName) selected.add(fileName);
  }

  if (selected.size === 0) {
    const fallback = parseSelectedFileName(config.flowPath);
    if (fallback) selected.add(fallback);
  }

  return [...selected];
}

function toggleJidInTextarea(current: string, jid: string, shouldInclude: boolean): string {
  const set = new Set(parseTextareaList(current));
  if (shouldInclude) {
    set.add(jid);
  } else {
    set.delete(jid);
  }
  return [...set].join('\n');
}

export function SetupView({
  needsInitialSetup,
  bots,
  setupConfig,
  busyLoad,
  busyTargets,
  busySave,
  onReloadBots,
  onRefreshTargets,
  onSave,
  setupTargets,
  onShowNotice,
}: SetupViewProps) {
  const initialTestJids = setupConfig && Array.isArray(setupConfig.testJids) ? setupConfig.testJids : [];
  const initialGroupWhitelistJids =
    setupConfig && Array.isArray(setupConfig.groupWhitelistJids) ? setupConfig.groupWhitelistJids : [];

  const [botRuntimeMode, setBotRuntimeMode] = useState(
    String(setupConfig?.botRuntimeMode || 'single-flow')
  );
  const [runtimeMode, setRuntimeMode] = useState(
    String(setupConfig?.runtimeMode || 'production')
  );
  const [selectedFiles, setSelectedFiles] = useState<string[]>(
    setupConfig ? toSelectedFilesFromConfig(setupConfig) : []
  );
  const [autoReloadFlows, setAutoReloadFlows] = useState(
    setupConfig?.autoReloadFlows !== false
  );
  const [broadcastIntervalInput, setBroadcastIntervalInput] = useState(
    String(Math.max(0, Number(setupConfig?.broadcastSendIntervalMs ?? 250) || 250))
  );
  const [testTargetsInput, setTestTargetsInput] = useState(
    initialTestJids.join('\n')
  );
  const [groupWhitelistInput, setGroupWhitelistInput] = useState(
    initialGroupWhitelistJids.join('\n')
  );
  const [dashboardHost, setDashboardHost] = useState(
    String(setupConfig?.dashboardHost || '127.0.0.1')
  );
  const [dashboardPortInput, setDashboardPortInput] = useState(
    String(Number(setupConfig?.dashboardPort || 8787))
  );
  const [targetSearch, setTargetSearch] = useState('');

  const selectedBotMeta = useMemo(
    () => bots.filter(bot => selectedFiles.includes(bot.fileName)),
    [bots, selectedFiles]
  );
  const selectedConversationFlowCount = useMemo(
    () => selectedBotMeta.filter(bot => String(bot.botType).toLowerCase() === 'conversation').length,
    [selectedBotMeta]
  );
  const selectedCommandFlowCount = useMemo(
    () => selectedBotMeta.filter(bot => String(bot.botType).toLowerCase() === 'command').length,
    [selectedBotMeta]
  );
  const selectedTestTargetSet = useMemo(
    () => new Set(parseTextareaList(testTargetsInput)),
    [testTargetsInput]
  );
  const selectedWhitelistSet = useMemo(
    () => new Set(parseTextareaList(groupWhitelistInput)),
    [groupWhitelistInput]
  );

  const filteredContacts = useMemo(() => {
    const all = Array.isArray(setupTargets?.contacts) ? setupTargets.contacts : [];
    const normalizedSearch = String(targetSearch || '').trim().toLowerCase();
    if (!normalizedSearch) return all;
    return all.filter(item => {
      const jid = String(item?.jid ?? '').toLowerCase();
      const name = String(item?.name ?? '').toLowerCase();
      return jid.includes(normalizedSearch) || name.includes(normalizedSearch);
    });
  }, [setupTargets, targetSearch]);

  const filteredGroups = useMemo(() => {
    const all = Array.isArray(setupTargets?.groups) ? setupTargets.groups : [];
    const normalizedSearch = String(targetSearch || '').trim().toLowerCase();
    if (!normalizedSearch) return all;
    return all.filter(item => {
      const jid = String(item?.jid ?? '').toLowerCase();
      const name = String(item?.name ?? '').toLowerCase();
      return jid.includes(normalizedSearch) || name.includes(normalizedSearch);
    });
  }, [setupTargets, targetSearch]);

  const handleToggleFlow = (fileName: string) => {
    setSelectedFiles(previous => {
      if (botRuntimeMode === 'single-flow') {
        return [fileName];
      }
      return previous.includes(fileName)
        ? previous.filter(item => item !== fileName)
        : [...previous, fileName];
    });
  };

  const handleSave = () => {
    const validBots = bots.filter(bot => bot.syntaxValid !== false);
    const selectedValidFiles = selectedFiles.filter(fileName => validBots.some(bot => bot.fileName === fileName));

    if (selectedValidFiles.length === 0) {
      onShowNotice?.('Selecione ao menos 1 flow válido.');
      return;
    }

    const finalSelectedFiles =
      botRuntimeMode === 'single-flow'
        ? [selectedValidFiles[0]]
        : selectedValidFiles;

    const finalSelectedMeta = bots.filter(bot => finalSelectedFiles.includes(bot.fileName));
    const conversationCount = finalSelectedMeta.filter(bot => String(bot.botType).toLowerCase() === 'conversation').length;
    if (conversationCount > 1) {
      onShowNotice?.('Apenas 1 flow de conversa pode ficar ativo ao mesmo tempo.');
      return;
    }

    const flowPaths = finalSelectedFiles.map(fileName => `./bots/${fileName}`);
    const conversationFile = finalSelectedMeta.find(bot => String(bot.botType).toLowerCase() === 'conversation')?.fileName || '';
    const primaryFlowPath = conversationFile ? `./bots/${conversationFile}` : flowPaths[0];

    const testJids = parseTextareaList(testTargetsInput);
    if (runtimeMode === 'restricted-test' && testJids.length === 0) {
      onShowNotice?.('Modo Teste restrito exige ao menos 1 contato/grupo permitido.');
      return;
    }

    const groupWhitelistJids = parseTextareaList(groupWhitelistInput);
    const broadcastSendIntervalMs = Math.max(0, Math.floor(Number(broadcastIntervalInput) || 0));
    const dashboardPort = Math.max(1, Math.min(65535, Math.floor(Number(dashboardPortInput) || 8787)));

    onSave({
      botRuntimeMode,
      runtimeMode,
      flowPath: primaryFlowPath,
      flowPaths,
      autoReloadFlows,
      broadcastSendIntervalMs,
      testTargetMode: 'contacts-and-groups',
      testJid: testJids[0] || '',
      testJids,
      groupWhitelistJids,
      dashboardHost: String(dashboardHost || '127.0.0.1').trim() || '127.0.0.1',
      dashboardPort,
    });
  };

  return (
    <section className="mx-auto grid max-w-[1560px] grid-cols-1 gap-4 xl:grid-cols-2">
      <article className={panelClass}>
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold">Setup Inicial</h3>
            <p className="mt-1 text-xs text-slate-600">
              {needsInitialSetup
                ? 'Finalize esta configuração para iniciar o runtime e autenticar o WhatsApp via terminal.'
                : 'Edite a configuração em tempo real. As alterações são aplicadas imediatamente.'}
            </p>
          </div>
          <button
            type="button"
            className={`${buttonBaseClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onReloadBots}
            disabled={busyLoad || busySave}
          >
            {busyLoad ? 'Atualizando...' : 'Atualizar Flows'}
          </button>
        </header>

        <div className="grid grid-cols-1 gap-3">
          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Arquitetura</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  botRuntimeMode === 'single-flow'
                    ? 'border-[#174d9d] bg-[#1e63c9] text-white'
                    : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => setBotRuntimeMode('single-flow')}
                disabled={busySave}
              >
                Single-flow
              </button>
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  botRuntimeMode === 'multi-bot'
                    ? 'border-[#174d9d] bg-[#1e63c9] text-white'
                    : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => setBotRuntimeMode('multi-bot')}
                disabled={busySave}
              >
                Multi-bot
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Modo de execução</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { value: 'production', label: 'Produção' },
                { value: 'development', label: 'Desenvolvimento' },
                { value: 'restricted-test', label: 'Teste restrito' },
              ].map(item => (
                <button
                  key={item.value}
                  type="button"
                  className={[
                    buttonBaseClass,
                    runtimeMode === item.value
                      ? 'border-[#174d9d] bg-[#1e63c9] text-white'
                      : 'border-[#d4e0f1] bg-white text-slate-700',
                  ].join(' ')}
                  onClick={() => setRuntimeMode(item.value)}
                  disabled={busySave}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="m-0 text-sm font-semibold text-slate-700">Flows Ativos</p>
              <small className="text-xs text-slate-500">
                Conversa: {selectedConversationFlowCount} | Comando: {selectedCommandFlowCount}
              </small>
            </div>
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {bots.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhum flow encontrado em bots/.</p>
              ) : (
                bots.map(bot => {
                  const selected = selectedFiles.includes(bot.fileName);
                  const disabled = busySave || bot.syntaxValid === false;
                  return (
                    <label
                      key={bot.fileName}
                      className={[
                        'flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm',
                        selected ? 'border-[#d9e6f6] bg-[#e6f0ff]' : 'border-[#d9e6f6] bg-white',
                        disabled ? 'cursor-not-allowed opacity-65' : '',
                      ].join(' ')}
                    >
                      <input
                        type={botRuntimeMode === 'single-flow' ? 'radio' : 'checkbox'}
                        name="setup-flow-selector"
                        checked={selected}
                        onChange={() => handleToggleFlow(bot.fileName)}
                        disabled={disabled}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-800">
                          {bot.fileName} ({bot.botType})
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {bot.flowPath}
                        </span>
                        {!bot.syntaxValid ? (
                          <span className="block text-[11px] text-red-600">
                            Sintaxe inválida: {bot.syntaxError || 'erro não identificado'}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </article>

      <article className={panelClass}>
        <header className="mb-3">
          <h3 className="text-base font-extrabold">Ajustes Avancados</h3>
        </header>

        <div className="grid grid-cols-1 gap-3">
          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Auto-reload</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  autoReloadFlows ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => setAutoReloadFlows(true)}
                disabled={busySave}
              >
                Habilitado
              </button>
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  !autoReloadFlows ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => setAutoReloadFlows(false)}
                disabled={busySave}
              >
                Desabilitado
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="m-0 text-sm font-semibold text-slate-700">Alvos Detectados em Tempo Real</p>
              <button
                type="button"
                className={`${buttonBaseClass} border-[#d4e0f1] bg-white text-slate-700 hover:bg-slate-50`}
                onClick={onRefreshTargets}
                disabled={busySave || busyTargets}
              >
                {busyTargets ? 'Atualizando...' : 'Atualizar'}
              </button>
            </div>
            <small className="text-xs text-slate-500">
              Atualização automática a cada ~4s enquanto esta aba estiver aberta.
            </small>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={targetSearch}
                onChange={event => setTargetSearch(event.target.value)}
                placeholder="Buscar por nome/JID"
                disabled={busySave}
                className={`${inputBaseClass} w-full max-w-[260px]`}
              />
              <span className="text-xs text-slate-500">
                WhatsApp: {setupTargets?.socketReady ? 'conectado' : 'aguardando conexao'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">
                  Contatos para Teste Restrito ({filteredContacts.length})
                </p>
                <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-[#d9e6f6] bg-white p-2">
                  {filteredContacts.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum contato detectado.</p>
                  ) : filteredContacts.map(item => {
                    const jid = String(item.jid || '').trim();
                    const checked = selectedTestTargetSet.has(jid);
                    return (
                      <label key={`contact-${jid}`} className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={event => {
                            setTestTargetsInput(previous => (
                              toggleJidInTextarea(previous, jid, event.target.checked)
                            ));
                          }}
                          disabled={busySave}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{item.name || jid}</span>
                          <span className="block truncate text-[11px] text-slate-500">{jid}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">
                  Grupos para Teste e Whitelist ({filteredGroups.length})
                </p>
                <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-[#d9e6f6] bg-white p-2">
                  {filteredGroups.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum grupo detectado.</p>
                  ) : filteredGroups.map(item => {
                    const jid = String(item.jid || '').trim();
                    const checkedTest = selectedTestTargetSet.has(jid);
                    const checkedWhitelist = selectedWhitelistSet.has(jid);
                    const participants = Math.max(0, Number(item.participants || 0));
                    return (
                      <div key={`group-${jid}`} className="rounded-md border border-[#e7eef8] bg-white p-2">
                        <div className="mb-1">
                          <span className="block truncate text-xs font-semibold text-slate-700">{item.name || jid}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {jid} {participants > 0 ? `| ${participants} participantes` : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-700">
                            <input
                              type="checkbox"
                              checked={checkedTest}
                              onChange={event => {
                                setTestTargetsInput(previous => (
                                  toggleJidInTextarea(previous, jid, event.target.checked)
                                ));
                              }}
                              disabled={busySave}
                            />
                            Teste Restrito
                          </label>
                          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-700">
                            <input
                              type="checkbox"
                              checked={checkedWhitelist}
                              onChange={event => {
                                setGroupWhitelistInput(previous => (
                                  toggleJidInTextarea(previous, jid, event.target.checked)
                                ));
                              }}
                              disabled={busySave}
                            />
                            Whitelist
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <label className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Intervalo de Broadcast (ms)</p>
            <input
              type="number"
              min={0}
              step={50}
              value={broadcastIntervalInput}
              onChange={event => setBroadcastIntervalInput(event.target.value)}
              disabled={busySave}
              className={`${inputBaseClass} mt-2 w-full max-w-[220px]`}
            />
          </label>

          <label className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Contatos/Grupos do Teste Restrito</p>
            <small className="text-xs text-slate-500">Um JID por linha (ou separados por virgula).</small>
            <textarea
              value={testTargetsInput}
              onChange={event => setTestTargetsInput(event.target.value)}
              disabled={busySave}
              rows={5}
              className="mt-2 w-full rounded-xl border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
              placeholder="5511999999999@s.whatsapp.net&#10;120363000000000000@g.us"
            />
          </label>

          <label className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Whitelist de Grupos</p>
            <small className="text-xs text-slate-500">Necessario para flows com escopo group-whitelist.</small>
            <textarea
              value={groupWhitelistInput}
              onChange={event => setGroupWhitelistInput(event.target.value)}
              disabled={busySave}
              rows={4}
              className="mt-2 w-full rounded-xl border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
              placeholder="120363000000000000@g.us"
            />
          </label>

          <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 md:grid-cols-2">
            <label>
              <p className="m-0 text-sm font-semibold text-slate-700">Dashboard Host</p>
              <input
                type="text"
                value={dashboardHost}
                onChange={event => setDashboardHost(event.target.value)}
                disabled={busySave}
                className={`${inputBaseClass} mt-2 w-full`}
              />
            </label>
            <label>
              <p className="m-0 text-sm font-semibold text-slate-700">Dashboard Port</p>
              <input
                type="number"
                min={1}
                max={65535}
                value={dashboardPortInput}
                onChange={event => setDashboardPortInput(event.target.value)}
                disabled={busySave}
                className={`${inputBaseClass} mt-2 w-full`}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className={`${buttonBaseClass} border-[#174d9d] bg-[#1e63c9] px-4 text-white hover:bg-[#174d9d]`}
              onClick={handleSave}
              disabled={busySave || busyLoad}
            >
              {busySave ? 'Salvando...' : needsInitialSetup ? 'Salvar e Iniciar Runtime' : 'Salvar Configuração'}
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}
