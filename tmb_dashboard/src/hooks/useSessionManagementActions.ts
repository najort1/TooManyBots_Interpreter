import { useCallback } from 'react';
import type { SessionFlowConfigItem } from '../types';
import {
  postClearAllActiveSessions,
  postClearFlowSessions,
  postResetSessionByJid,
  postUpdateFlowSessionTimeout,
} from '../lib/api';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function useSessionManagementActions({
  sessionFlows,
  sessionSelectedFlowPath,
  sessionTimeoutInputMinutes,
  sessionResetJidInput,
  refreshSessionManagement,
  setSessionSelectedFlowPath,
  setSessionTimeoutInputMinutes,
  setBusySessionAction,
  setSessionResetJidInput,
  setSessionFlows,
  showNotice,
}: any) {
  const handleSelectSessionFlow = useCallback((flowPath: string) => {
    setSessionSelectedFlowPath(flowPath);
    const flow = sessionFlows.find((item: SessionFlowConfigItem) => item.flowPath === flowPath);
    setSessionTimeoutInputMinutes(flow ? String(flow.sessionTimeoutMinutes) : '');
  }, [sessionFlows, setSessionSelectedFlowPath, setSessionTimeoutInputMinutes]);

  const handleClearAllSessions = useCallback(async () => {
    setBusySessionAction(true);
    try {
      const result = await postClearAllActiveSessions();
      showNotice(`Sessoes ativas removidas: ${result.removed}.`);
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao limpar sessoes ativas: ${getErrorMessage(error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, setBusySessionAction, showNotice]);

  const handleClearSessionsByFlow = useCallback(async () => {
    const flowPath = sessionSelectedFlowPath.trim();
    if (!flowPath) {
      showNotice('Selecione um flow para limpar sessoes.');
      return;
    }
    setBusySessionAction(true);
    try {
      const result = await postClearFlowSessions(flowPath);
      showNotice(`Sessoes removidas do flow selecionado: ${result.removed}.`);
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao limpar sessoes do flow: ${getErrorMessage(error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, sessionSelectedFlowPath, setBusySessionAction, showNotice]);

  const handleResetSessionByJid = useCallback(async () => {
    const jid = sessionResetJidInput.trim();
    if (!jid) {
      showNotice('Informe um JID valido.');
      return;
    }
    setBusySessionAction(true);
    try {
      const result = await postResetSessionByJid(jid);
      showNotice(`Sessoes removidas para o JID informado: ${result.removed}.`);
      setSessionResetJidInput('');
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao resetar sessao por JID: ${getErrorMessage(error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, sessionResetJidInput, setBusySessionAction, setSessionResetJidInput, showNotice]);

  const handleUpdateSessionTimeout = useCallback(async () => {
    const flowPath = sessionSelectedFlowPath.trim();
    if (!flowPath) {
      showNotice('Selecione um flow para atualizar timeout.');
      return;
    }
    const timeoutValue = Number(sessionTimeoutInputMinutes);
    if (!Number.isFinite(timeoutValue) || timeoutValue < 0) {
      showNotice('Informe um timeout valido (>= 0).');
      return;
    }
    setBusySessionAction(true);
    try {
      const result = await postUpdateFlowSessionTimeout(flowPath, Math.floor(timeoutValue));
      setSessionFlows((previous: SessionFlowConfigItem[]) =>
        previous.map((flow: SessionFlowConfigItem) =>
          flow.flowPath === result.flowPath
            ? { ...flow, sessionTimeoutMinutes: result.sessionTimeoutMinutes }
            : flow
        )
      );
      setSessionTimeoutInputMinutes(String(result.sessionTimeoutMinutes));
      showNotice(`Timeout atualizado para ${result.sessionTimeoutMinutes} min em ${result.flowPath}.`);
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao atualizar timeout do flow: ${getErrorMessage(error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, sessionSelectedFlowPath, sessionTimeoutInputMinutes, setBusySessionAction, setSessionFlows, setSessionTimeoutInputMinutes, showNotice]);

  return {
    handleSelectSessionFlow,
    handleClearAllSessions,
    handleClearSessionsByFlow,
    handleResetSessionByJid,
    handleUpdateSessionTimeout,
  };
}

