import { useEffect, useMemo, useState } from 'react';
import { buttonBaseClass, inputBaseClass } from '../../lib/uiTokens';
import { fetchSurveyTypes, linkSurveyToBot } from '../../lib/surveyApi';
import type { BotInfo, BotSurveyConfig, RuntimeSetupConfig, SurveyTypeDefinition } from '../../types';

interface BotSurveyLinkerProps {
  bots: BotInfo[];
  setupConfig: RuntimeSetupConfig | null;
  busy?: boolean;
  onLinked?: () => void;
  onShowNotice?: (message: string) => void;
}

const triggerOptions = [
  { value: 'session_end', label: 'Fim normal' },
  { value: 'human_handoff_end', label: 'Fim do handoff' },
  { value: 'timeout', label: 'Timeout' },
];

function configForFlow(config: RuntimeSetupConfig | null, flowPath: string): BotSurveyConfig {
  const stored = config?.surveyConfigsByFlowPath?.[flowPath];
  return {
    postSessionSurveyTypeId: stored?.postSessionSurveyTypeId || null,
    triggerOn: Array.isArray(stored?.triggerOn) && stored.triggerOn.length > 0 ? stored.triggerOn : ['session_end'],
    skipIfRecentlyCompleted: stored?.skipIfRecentlyCompleted !== false,
    skipWindowHours: Math.max(0, Number(stored?.skipWindowHours ?? 24) || 24),
  };
}

export function BotSurveyLinker({ bots, setupConfig, busy = false, onLinked, onShowNotice }: BotSurveyLinkerProps) {
  const conversationBots = useMemo(
    () => bots.filter(bot => String(bot.botType || '').toLowerCase() === 'conversation' && bot.syntaxValid !== false),
    [bots]
  );
  const [surveys, setSurveys] = useState<SurveyTypeDefinition[]>([]);
  const [selectedBot, setSelectedBot] = useState(conversationBots[0]?.fileName || '');
  const selectedMeta = conversationBots.find(bot => bot.fileName === selectedBot) || conversationBots[0] || null;
  const selectedFlowPath = selectedMeta?.flowPath || (selectedBot ? `./bots/${selectedBot}` : '');
  const currentConfig = configForFlow(setupConfig, selectedFlowPath);
  const [surveyTypeId, setSurveyTypeId] = useState(currentConfig.postSessionSurveyTypeId || '');
  const [triggerOn, setTriggerOn] = useState<string[]>(currentConfig.triggerOn);
  const [skipIfRecentlyCompleted, setSkipIfRecentlyCompleted] = useState(currentConfig.skipIfRecentlyCompleted);
  const [skipWindowHours, setSkipWindowHours] = useState(String(currentConfig.skipWindowHours));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchSurveyTypes(true).then(setSurveys).catch(error => {
      onShowNotice?.(`Falha ao carregar pesquisas ativas: ${String((error as Error)?.message || error)}`);
    });
  }, [onShowNotice]);

  useEffect(() => {
    if (conversationBots.length === 0) {
      if (selectedBot) setSelectedBot('');
      return;
    }
    if (!conversationBots.some(bot => bot.fileName === selectedBot)) {
      setSelectedBot(conversationBots[0].fileName);
    }
  }, [conversationBots, selectedBot]);

  useEffect(() => {
    const next = configForFlow(setupConfig, selectedFlowPath);
    setSurveyTypeId(next.postSessionSurveyTypeId || '');
    setTriggerOn(next.triggerOn);
    setSkipIfRecentlyCompleted(next.skipIfRecentlyCompleted);
    setSkipWindowHours(String(next.skipWindowHours));
  }, [selectedFlowPath, setupConfig]);

  const toggleTrigger = (value: string, checked: boolean) => {
    setTriggerOn(previous => {
      const next = checked ? [...previous, value] : previous.filter(item => item !== value);
      return [...new Set(next)];
    });
  };

  const handleSave = async () => {
    if (!selectedBot || !surveyTypeId) {
      onShowNotice?.('Selecione um bot de conversa e uma pesquisa ativa.');
      return;
    }
    if (triggerOn.length === 0) {
      onShowNotice?.('Selecione ao menos um gatilho de envio.');
      return;
    }
    setSaving(true);
    try {
      const result = await linkSurveyToBot(selectedBot, {
        postSessionSurveyTypeId: surveyTypeId,
        triggerOn,
        skipIfRecentlyCompleted,
        skipWindowHours: Math.max(0, Math.floor(Number(skipWindowHours) || 0)),
      });
      if (!result.ok) throw new Error(result.error || 'failed-to-link-survey');
      onShowNotice?.('Pesquisa vinculada ao bot.');
      onLinked?.();
    } catch (error) {
      onShowNotice?.(`Falha ao vincular pesquisa: ${String((error as Error)?.message || error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
      <p className="m-0 text-sm font-semibold text-slate-700">Pesquisa pos-atendimento</p>
      <div className="mt-3 grid grid-cols-1 gap-2">
        <select
          value={selectedBot}
          onChange={event => setSelectedBot(event.target.value)}
          className={`${inputBaseClass} w-full`}
          disabled={busy || saving}
        >
          {conversationBots.length === 0 ? <option value="">Nenhum bot de conversa</option> : null}
          {conversationBots.map(bot => (
            <option key={bot.fileName} value={bot.fileName}>{bot.fileName}</option>
          ))}
        </select>
        <select
          value={surveyTypeId}
          onChange={event => setSurveyTypeId(event.target.value)}
          className={`${inputBaseClass} w-full`}
          disabled={busy || saving}
        >
          <option value="">Selecione uma pesquisa ativa</option>
          {surveys.map(survey => (
            <option key={survey.typeId} value={survey.typeId}>{survey.name}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-3">
          {triggerOptions.map(item => (
            <label key={item.value} className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={triggerOn.includes(item.value)}
                onChange={event => toggleTrigger(item.value, event.target.checked)}
                disabled={busy || saving}
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={skipIfRecentlyCompleted}
              onChange={event => setSkipIfRecentlyCompleted(event.target.checked)}
              disabled={busy || saving}
            />
            Nao enviar se ja respondeu recentemente
          </label>
          <input
            type="number"
            min={0}
            value={skipWindowHours}
            onChange={event => setSkipWindowHours(event.target.value)}
            className={`${inputBaseClass} w-full`}
            disabled={busy || saving || !skipIfRecentlyCompleted}
          />
        </div>
        <button
          type="button"
          className={`${buttonBaseClass} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
          onClick={handleSave}
          disabled={busy || saving || !selectedBot || !surveyTypeId}
        >
          {saving ? 'Salvando...' : 'Salvar vinculo'}
        </button>
      </div>
    </section>
  );
}
