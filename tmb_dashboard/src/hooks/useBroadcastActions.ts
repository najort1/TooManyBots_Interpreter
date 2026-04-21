import { useCallback } from 'react';
import { postBroadcastCancel, postBroadcastPause, postBroadcastResume, postBroadcastSend } from '../lib/api';
import { fileToDataUrl } from '../lib/appUtils';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function useBroadcastActions({
  broadcastMessage,
  broadcastImageDataUrl,
  broadcastImageFileName,
  broadcastRecipientMode,
  selectedBroadcastJids,
  broadcastContacts,
  setPendingConfirmAction,
  setSelectedBroadcastJids,
  setBroadcastImageDataUrl,
  setBroadcastImagePreviewUrl,
  setBroadcastImageFileName,
  setBroadcastProgress,
  setBroadcastLastResult,
  setBusyBroadcastSend,
  setBroadcastMessage,
  activeBroadcastCampaignIdRef,
  busyBroadcastSendRef,
  showNotice,
}: any) {
  const openBroadcastSendModal = useCallback(() => {
    const hasText = broadcastMessage.trim().length > 0;
    const hasImage = broadcastImageDataUrl.length > 0;
    if (!hasText && !hasImage) {
      showNotice('Informe texto ou imagem para enviar o anuncio.');
      return;
    }

    if (broadcastRecipientMode === 'selected' && selectedBroadcastJids.length === 0) {
      showNotice('Selecione ao menos um destinatario.');
      return;
    }

    setPendingConfirmAction('send-broadcast');
  }, [broadcastImageDataUrl, broadcastMessage, broadcastRecipientMode, selectedBroadcastJids.length, setPendingConfirmAction, showNotice]);

  const handleToggleBroadcastRecipient = useCallback((jid: string) => {
    setSelectedBroadcastJids((previous: string[]) => {
      if (previous.includes(jid)) {
        return previous.filter((item: string) => item !== jid);
      }
      return [...previous, jid];
    });
  }, [setSelectedBroadcastJids]);

  const handleSelectAllBroadcastVisible = useCallback(() => {
    setSelectedBroadcastJids((previous: string[]) => {
      const merged = new Set(previous);
      for (const contact of broadcastContacts) {
        merged.add(contact.jid);
      }
      return [...merged];
    });
  }, [broadcastContacts, setSelectedBroadcastJids]);

  const handlePickBroadcastImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showNotice('Selecione um arquivo de imagem valido para o anuncio.');
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setBroadcastImageDataUrl(dataUrl);
      setBroadcastImagePreviewUrl(dataUrl);
      setBroadcastImageFileName(file.name);
    } catch (error) {
      showNotice(`Nao foi possivel ler a imagem: ${getErrorMessage(error)}`);
    }
  }, [setBroadcastImageDataUrl, setBroadcastImageFileName, setBroadcastImagePreviewUrl, showNotice]);

  const handleSendBroadcast = useCallback(async () => {
    const hasText = broadcastMessage.trim().length > 0;
    const hasImage = broadcastImageDataUrl.length > 0;
    if (!hasText && !hasImage) {
      showNotice('Informe texto ou imagem para enviar o anuncio.');
      return;
    }

    if (broadcastRecipientMode === 'selected' && selectedBroadcastJids.length === 0) {
      showNotice('Selecione ao menos um destinatario.');
      return;
    }

    const estimatedAttempted = Math.max(
      0,
      broadcastRecipientMode === 'all' ? broadcastContacts.length : selectedBroadcastJids.length
    );

    activeBroadcastCampaignIdRef.current = null;
    setBroadcastProgress({
      campaignId: 0,
      attempted: estimatedAttempted,
      processed: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
      remaining: estimatedAttempted,
      percent: 0,
      status: 'started',
      controlStatus: 'running',
      recipientStatus: '',
      jid: '',
    });
    setBroadcastLastResult(null);
    busyBroadcastSendRef.current = true;
    setBusyBroadcastSend(true);
    try {
      const result = await postBroadcastSend({
        target: broadcastRecipientMode,
        jids: selectedBroadcastJids,
        text: broadcastMessage,
        imageDataUrl: broadcastImageDataUrl || '',
        fileName: broadcastImageFileName || '',
      });
      activeBroadcastCampaignIdRef.current = result.campaignId || null;
      setBroadcastLastResult(result);
      const cancelledCount = Math.max(0, Number(result.cancelled) || 0);
      const processedCount = Math.max(0, Math.min(result.attempted, result.sent + result.failed + cancelledCount));
      const finalControlStatus = cancelledCount > 0 ? 'cancelled' : 'completed';
      setBroadcastProgress({
        campaignId: result.campaignId,
        attempted: result.attempted,
        processed: processedCount,
        sent: result.sent,
        failed: result.failed,
        cancelled: cancelledCount,
        remaining: Math.max(0, result.attempted - processedCount),
        percent: result.attempted > 0 ? Math.min(100, Math.round((processedCount / result.attempted) * 100)) : 0,
        status: 'completed',
        controlStatus: finalControlStatus,
        recipientStatus: '',
        jid: '',
        metrics: result.metrics ?? null,
      });
      if (cancelledCount > 0) {
        showNotice(
          `Campanha cancelada: ${result.sent}/${result.attempted} enviados, ${cancelledCount} pendente(s) cancelado(s).`
        );
      } else {
        showNotice(`Campanha enviada: ${result.sent}/${result.attempted} entregas.`);
      }
      if (result.failed === 0 && cancelledCount === 0) {
        setBroadcastMessage('');
        setBroadcastImageDataUrl('');
        setBroadcastImagePreviewUrl('');
        setBroadcastImageFileName('');
      }
    } catch (error) {
      activeBroadcastCampaignIdRef.current = null;
      setBroadcastProgress(null);
      const message = getErrorMessage(error);
      if (message.includes('campaign-in-progress')) {
        showNotice('Ja existe uma campanha em andamento. Aguarde ou cancele antes de iniciar outra.');
      } else {
        showNotice(`Falha ao enviar anuncio: ${message}`);
      }
    } finally {
      busyBroadcastSendRef.current = false;
      setBusyBroadcastSend(false);
    }
  }, [activeBroadcastCampaignIdRef, broadcastContacts.length, broadcastImageDataUrl, broadcastImageFileName, broadcastMessage, broadcastRecipientMode, busyBroadcastSendRef, selectedBroadcastJids, setBroadcastImageDataUrl, setBroadcastImageFileName, setBroadcastImagePreviewUrl, setBroadcastLastResult, setBroadcastMessage, setBroadcastProgress, setBusyBroadcastSend, showNotice]);

  const applyBroadcastControlResult = useCallback((campaign: any, fallbackMessage: string) => {
    if (campaign) {
      activeBroadcastCampaignIdRef.current = campaign.campaignId || activeBroadcastCampaignIdRef.current;
      setBroadcastProgress(campaign);
    }
    if (fallbackMessage) {
      showNotice(fallbackMessage);
    }
  }, [activeBroadcastCampaignIdRef, setBroadcastProgress, showNotice]);

  const handlePauseBroadcast = useCallback(async () => {
    try {
      const response = await postBroadcastPause();
      applyBroadcastControlResult(response?.campaign, 'Campanha pausada.');
    } catch (error) {
      showNotice(`Falha ao pausar campanha: ${getErrorMessage(error)}`);
    }
  }, [applyBroadcastControlResult, showNotice]);

  const handleResumeBroadcast = useCallback(async () => {
    try {
      const response = await postBroadcastResume();
      applyBroadcastControlResult(response?.campaign, 'Campanha retomada.');
    } catch (error) {
      showNotice(`Falha ao retomar campanha: ${getErrorMessage(error)}`);
    }
  }, [applyBroadcastControlResult, showNotice]);

  const handleCancelBroadcast = useCallback(async () => {
    try {
      const response = await postBroadcastCancel();
      applyBroadcastControlResult(response?.campaign, 'Cancelamento solicitado. Aguardando finalizar o envio em curso...');
    } catch (error) {
      showNotice(`Falha ao cancelar campanha: ${getErrorMessage(error)}`);
    }
  }, [applyBroadcastControlResult, showNotice]);

  return {
    openBroadcastSendModal,
    handleToggleBroadcastRecipient,
    handleSelectAllBroadcastVisible,
    handlePickBroadcastImage,
    handleSendBroadcast,
    handlePauseBroadcast,
    handleResumeBroadcast,
    handleCancelBroadcast,
  };
}

