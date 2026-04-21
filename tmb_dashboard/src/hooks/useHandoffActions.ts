import { useCallback } from 'react';
import { postHandoffEnd, postHandoffImage, postHandoffMessage, postHandoffResume } from '../lib/api';
import { fileToDataUrl, shouldIgnoreRequestError } from '../lib/appUtils';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function useHandoffActions({
  selectedJidRef,
  handoffMessage,
  resumeBlockId,
  setBusySend,
  setBusySendImage,
  setBusyResume,
  setBusyEnd,
  setHandoffMessage,
  setSelectedHandoffJid,
  setSelectedHandoffHistory,
  setResumeBlockId,
  setConfirmEndOpen,
  refreshHandoffHistory,
  refreshHandoffQueue,
  refreshStats,
  markSessionAsResponded,
  showNotice,
}: any) {
  const handleSelectHandoffSession = useCallback(async (jid: string) => {
    setSelectedHandoffJid(jid);
    setResumeBlockId('');
    try {
      await refreshHandoffHistory(jid);
    } catch (error) {
      if (shouldIgnoreRequestError(error)) return;
      showNotice(`Falha ao carregar historico: ${getErrorMessage(error)}`);
    }
  }, [refreshHandoffHistory, setResumeBlockId, setSelectedHandoffJid, showNotice]);

  const handleSendHandoff = useCallback(async () => {
    const jid = selectedJidRef.current;
    const text = handoffMessage.trim();
    if (!jid || !text) return;

    setBusySend(true);
    try {
      await postHandoffMessage(jid, text);
      setHandoffMessage('');
      markSessionAsResponded(jid, text, 'human-message-outgoing');
      await refreshHandoffHistory(jid);
      await refreshHandoffQueue();
    } catch (error) {
      showNotice(`Nao foi possivel enviar a mensagem: ${getErrorMessage(error)}`);
    } finally {
      setBusySend(false);
    }
  }, [handoffMessage, markSessionAsResponded, refreshHandoffHistory, refreshHandoffQueue, selectedJidRef, setBusySend, setHandoffMessage, showNotice]);

  const handleSendHandoffImage = useCallback(async (file: File) => {
    const jid = selectedJidRef.current;
    if (!jid) return;

    if (!file.type.startsWith('image/')) {
      showNotice('Selecione um arquivo de imagem valido.');
      return;
    }

    setBusySendImage(true);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const caption = handoffMessage.trim();
      await postHandoffImage(jid, imageDataUrl, {
        caption,
        fileName: file.name,
        mimeType: file.type,
      });
      setHandoffMessage('');
      markSessionAsResponded(jid, caption || `[Imagem] ${file.name}`, 'human-image-outgoing');
      await refreshHandoffHistory(jid);
      await refreshHandoffQueue();
    } catch (error) {
      showNotice(`Nao foi possivel enviar a imagem: ${getErrorMessage(error)}`);
    } finally {
      setBusySendImage(false);
    }
  }, [handoffMessage, markSessionAsResponded, refreshHandoffHistory, refreshHandoffQueue, selectedJidRef, setBusySendImage, setHandoffMessage, showNotice]);

  const handleResumeHandoff = useCallback(async () => {
    const jid = selectedJidRef.current;
    if (!jid) return;
    if (!resumeBlockId.trim()) {
      showNotice('Selecione um bloco para retomar a sessao.');
      return;
    }

    setBusyResume(true);
    try {
      await postHandoffResume(jid, resumeBlockId);
      await refreshHandoffQueue();
      await refreshStats();
      showNotice('Sessao retomada com sucesso.');
    } catch (error) {
      showNotice(`Nao foi possivel retomar a sessao: ${getErrorMessage(error)}`);
    } finally {
      setBusyResume(false);
    }
  }, [refreshHandoffQueue, refreshStats, resumeBlockId, selectedJidRef, setBusyResume, showNotice]);

  const handleEndHandoff = useCallback(async () => {
    const jid = selectedJidRef.current;
    if (!jid) return;

    setBusyEnd(true);
    try {
      await postHandoffEnd(jid);
      setSelectedHandoffJid('');
      setSelectedHandoffHistory([]);
      setResumeBlockId('');
      setConfirmEndOpen(false);
      await Promise.all([refreshHandoffQueue(), refreshStats()]);
      showNotice('Sessao encerrada com sucesso.');
    } catch (error) {
      showNotice(`Nao foi possivel encerrar a sessao: ${getErrorMessage(error)}`);
    } finally {
      setBusyEnd(false);
    }
  }, [refreshHandoffQueue, refreshStats, selectedJidRef, setBusyEnd, setConfirmEndOpen, setResumeBlockId, setSelectedHandoffHistory, setSelectedHandoffJid, showNotice]);

  const openEndSessionModal = useCallback(() => {
    if (!selectedJidRef.current) return;
    setConfirmEndOpen(true);
  }, [selectedJidRef, setConfirmEndOpen]);

  return {
    handleSelectHandoffSession,
    handleSendHandoff,
    handleSendHandoffImage,
    handleResumeHandoff,
    handleEndHandoff,
    openEndSessionModal,
  };
}

