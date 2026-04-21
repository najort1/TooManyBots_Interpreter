import { useCallback } from 'react';
import { postClearRuntimeCache, postDbMaintenanceConfig, postRunDbMaintenance, postRuntimeSettings } from '../lib/api';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function useSettingsActions({
  loadRuntimeSettings,
  loadDbInfo,
  loadDbMaintenance,
  refreshObservability,
  setAutoReloadFlows,
  setBroadcastSendIntervalMs,
  setDashboardTelemetryLevel,
  setDbMaintenanceConfig,
  setDbMaintenanceStatus,
  setBusySaveSettings,
  setBusyClearRuntimeCache,
  setBusySaveDbMaintenance,
  setBusyRunDbMaintenance,
  showNotice,
}: any) {
  const handleToggleAutoReload = useCallback(async (value: any) => {
    setBusySaveSettings(true);
    try {
      const updated = await postRuntimeSettings({ autoReloadFlows: value });
      setAutoReloadFlows(updated.autoReloadFlows !== false);
      setBroadcastSendIntervalMs(Math.max(0, Math.floor(Number(updated.broadcastSendIntervalMs ?? 250) || 250)));
      showNotice(`Auto-reload ${updated.autoReloadFlows ? 'habilitado' : 'desabilitado'} com sucesso.`);
    } catch (error) {
      showNotice(`Falha ao atualizar auto-reload: ${getErrorMessage(error)}`);
    } finally {
      setBusySaveSettings(false);
    }
  }, [setAutoReloadFlows, setBroadcastSendIntervalMs, setBusySaveSettings, showNotice]);

  const handleUpdateBroadcastSendInterval = useCallback(async (value: any) => {
    const normalized = Math.max(0, Math.floor(Number(value) || 0));
    setBusySaveSettings(true);
    try {
      const updated = await postRuntimeSettings({ broadcastSendIntervalMs: normalized });
      setAutoReloadFlows(updated.autoReloadFlows !== false);
      const effective = Math.max(0, Math.floor(Number(updated.broadcastSendIntervalMs ?? normalized) || normalized));
      setBroadcastSendIntervalMs(effective);
      showNotice(`Intervalo do anuncio em massa atualizado para ${effective} ms.`);
    } catch (error) {
      showNotice(`Falha ao atualizar intervalo do anuncio em massa: ${getErrorMessage(error)}`);
    } finally {
      setBusySaveSettings(false);
    }
  }, [setAutoReloadFlows, setBroadcastSendIntervalMs, setBusySaveSettings, showNotice]);

  const handleUpdateTelemetryLevel = useCallback(async (value: any) => {
    setBusySaveSettings(true);
    try {
      const updated = await postRuntimeSettings({ dashboardTelemetryLevel: value });
      const nextLevel = String(updated.dashboardTelemetryLevel || '').trim().toLowerCase();
      if (nextLevel === 'minimum' || nextLevel === 'operational' || nextLevel === 'diagnostic' || nextLevel === 'verbose') {
        setDashboardTelemetryLevel(nextLevel);
      } else {
        setDashboardTelemetryLevel(value);
      }
      await refreshObservability();
      showNotice(`Nivel de telemetria atualizado para ${value}.`);
    } catch (error) {
      showNotice(`Falha ao atualizar telemetria: ${getErrorMessage(error)}`);
    } finally {
      setBusySaveSettings(false);
    }
  }, [refreshObservability, setBusySaveSettings, setDashboardTelemetryLevel, showNotice]);

  const handleClearRuntimeCache = useCallback(async () => {
    setBusyClearRuntimeCache(true);
    try {
      await postClearRuntimeCache();
      showNotice('Cache runtime limpo com sucesso.');
    } catch (error) {
      showNotice(`Falha ao limpar cache runtime: ${getErrorMessage(error)}`);
    } finally {
      setBusyClearRuntimeCache(false);
    }
  }, [setBusyClearRuntimeCache, showNotice]);

  const handleSaveDbMaintenance = useCallback(async (input: any) => {
    setBusySaveDbMaintenance(true);
    try {
      const result = await postDbMaintenanceConfig(input);
      setDbMaintenanceConfig(result?.config || null);
      setDbMaintenanceStatus(result?.maintenanceStatus || null);
      await Promise.all([loadRuntimeSettings(), loadDbInfo()]);
      showNotice('Politica de manutencao do DB atualizada com sucesso.');
    } catch (error) {
      showNotice(`Falha ao atualizar manutencao do DB: ${getErrorMessage(error)}`);
    } finally {
      setBusySaveDbMaintenance(false);
    }
  }, [loadDbInfo, loadRuntimeSettings, setBusySaveDbMaintenance, setDbMaintenanceConfig, setDbMaintenanceStatus, showNotice]);

  const handleRunDbMaintenanceNow = useCallback(async () => {
    setBusyRunDbMaintenance(true);
    try {
      const result = await postRunDbMaintenance(true);
      if (!result?.ok) {
        throw new Error(String(result?.error || 'db-maintenance-failed'));
      }
      setDbMaintenanceStatus(result?.status || null);
      await Promise.all([loadDbInfo(), loadDbMaintenance()]);
      const durationMs = Number(result?.durationMs) || 0;
      showNotice(`Manutencao do DB executada (${durationMs} ms).`);
    } catch (error) {
      showNotice(`Falha ao executar manutencao do DB: ${getErrorMessage(error)}`);
    } finally {
      setBusyRunDbMaintenance(false);
    }
  }, [loadDbInfo, loadDbMaintenance, setBusyRunDbMaintenance, setDbMaintenanceStatus, showNotice]);

  return {
    handleToggleAutoReload,
    handleUpdateBroadcastSendInterval,
    handleUpdateTelemetryLevel,
    handleClearRuntimeCache,
    handleSaveDbMaintenance,
    handleRunDbMaintenanceNow,
  };
}

