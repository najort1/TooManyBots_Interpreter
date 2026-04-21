export function createSetupRuntimeStateController({
  getConfig,
  runtimeModeProduction,
  toTrimmedStringArray,
  listContactDisplayNames,
  contactCache,
  getContactDisplayName,
  fetchSelectableContacts,
  fetchSelectableGroups,
  getCurrentSocket,
  fetchSavedTestTargetJidsFromDb,
  isUserJid,
  isGroupJid,
} = {}) {
  function buildSetupConfigSnapshot() {
    const config = getConfig();
    return {
      botRuntimeMode: String(config?.botRuntimeMode || 'single-flow'),
      flowPath: String(config?.flowPath || ''),
      flowPaths: toTrimmedStringArray(config?.flowPaths),
      runtimeMode: String(config?.runtimeMode || runtimeModeProduction),
      autoReloadFlows: config?.autoReloadFlows !== false,
      broadcastSendIntervalMs: Number(config?.broadcastSendIntervalMs ?? 250),
      ingestionConcurrency: Number(config?.ingestionConcurrency ?? 8),
      ingestionQueueMax: Number(config?.ingestionQueueMax ?? 5000),
      ingestionQueueWarnThreshold: Number(config?.ingestionQueueWarnThreshold ?? 1000),
      schedulerGlobalConcurrency: Number(config?.schedulerGlobalConcurrency ?? 16),
      schedulerPerJidConcurrency: Number(config?.schedulerPerJidConcurrency ?? 1),
      schedulerPerFlowPathConcurrency: Number(config?.schedulerPerFlowPathConcurrency ?? 4),
      postProcessConcurrency: Number(config?.postProcessConcurrency ?? 2),
      postProcessQueueMax: Number(config?.postProcessQueueMax ?? 5000),
      mediaPipelineConcurrency: Number(config?.mediaPipelineConcurrency ?? 2),
      mediaPipelineQueueMax: Number(config?.mediaPipelineQueueMax ?? 500),
      whatsappReconnectBaseDelayMs: Number(config?.whatsappReconnectBaseDelayMs ?? 3000),
      whatsappReconnectMaxDelayMs: Number(config?.whatsappReconnectMaxDelayMs ?? 60000),
      whatsappReconnectBackoffMultiplier: Number(config?.whatsappReconnectBackoffMultiplier ?? 2),
      whatsappReconnectJitterPct: Number(config?.whatsappReconnectJitterPct ?? 20),
      whatsappReconnectAttemptsWindowMs: Number(config?.whatsappReconnectAttemptsWindowMs ?? (10 * 60 * 1000)),
      whatsappReconnectMaxAttemptsPerWindow: Number(config?.whatsappReconnectMaxAttemptsPerWindow ?? 12),
      whatsappReconnectCooldownMs: Number(config?.whatsappReconnectCooldownMs ?? (2 * 60 * 1000)),
      authCredsDebounceMs: Number(config?.authCredsDebounceMs ?? 250),
      authMetricsRefreshMs: Number(config?.authMetricsRefreshMs ?? 30_000),
      incomingMediaMaxBytes: Number(config?.incomingMediaMaxBytes ?? (8 * 1024 * 1024)),
      handoffMediaRetentionMinutes: Number(config?.handoffMediaRetentionMinutes ?? 180),
      handoffMediaCleanupIntervalMinutes: Number(config?.handoffMediaCleanupIntervalMinutes ?? 15),
      handoffMediaMaxStorageMb: Number(config?.handoffMediaMaxStorageMb ?? 512),
      whatsappMaxInboundPerMinute: Number(config?.whatsappMaxInboundPerMinute ?? 600),
      whatsappMaxServiceOutboundPerMinute: Number(config?.whatsappMaxServiceOutboundPerMinute ?? 300),
      whatsappMaxBroadcastOutboundPerMinute: Number(config?.whatsappMaxBroadcastOutboundPerMinute ?? 120),
      runtimeDegradedQueueRatio: Number(config?.runtimeDegradedQueueRatio ?? 90),
      runtimeDegradedReconnectPendingMs: Number(config?.runtimeDegradedReconnectPendingMs ?? 20_000),
      runtimeDegradedDropConversationEvents: config?.runtimeDegradedDropConversationEvents !== false,
      testTargetMode: String(config?.testTargetMode || 'contacts-and-groups'),
      testJid: String(config?.testJid || ''),
      testJids: toTrimmedStringArray(config?.testJids),
      groupWhitelistJids: toTrimmedStringArray(config?.groupWhitelistJids),
      dashboardHost: String(config?.dashboardHost || '127.0.0.1'),
      dashboardPort: Number(config?.dashboardPort || 8787),
    };
  }

  function normalizeSetupSearch(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function hydrateContactCacheFromDb(limit = 10000) {
    const rows = listContactDisplayNames(limit);
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    contactCache.hydrate(
      rows.map(item => ({
        jid: item?.jid,
        name: item?.name,
      }))
    );
    return rows.length;
  }

  function resolveContactDisplayName(jid) {
    const normalizedJid = String(jid ?? '').trim();
    if (!normalizedJid) return '';
    const raw = String(contactCache.get(normalizedJid)?.name ?? '').trim();
    if (raw) return raw.replace(/^~+\s*/, '').trim() || raw;
    const persisted = getContactDisplayName(normalizedJid);
    if (persisted) {
      contactCache.hydrate([{ jid: normalizedJid, name: persisted }]);
      return persisted;
    }
    return normalizedJid;
  }

  function targetMatchesSearch(target, normalizedSearch) {
    if (!normalizedSearch) return true;
    const jid = String(target?.jid ?? '').toLowerCase();
    const name = String(target?.name ?? '').toLowerCase();
    return jid.includes(normalizedSearch) || name.includes(normalizedSearch);
  }

  async function listSetupSelectableTargets({ search = '', limit = 300 } = {}) {
    const normalizedSearch = normalizeSetupSearch(search);
    const maxLimit = Math.max(1, Math.min(1000, Number(limit) || 300));

    const contactsFromCache = await fetchSelectableContacts(contactCache);
    const currentSocket = getCurrentSocket();
    const groupsFromSocket = currentSocket
      ? await fetchSelectableGroups(currentSocket).catch(() => [])
      : [];
    const recoveredFromDb = fetchSavedTestTargetJidsFromDb(contactCache, 2500);

    const contactsByJid = new Map();
    const groupsByJid = new Map();

    for (const contact of contactsFromCache) {
      const jid = String(contact?.jid ?? '').trim();
      if (!isUserJid(jid)) continue;
      contactsByJid.set(jid, {
        jid,
        name: String(contact?.name ?? jid).trim() || jid,
        source: 'cache',
      });
    }

    for (const group of groupsFromSocket) {
      const jid = String(group?.jid ?? '').trim();
      if (!isGroupJid(jid)) continue;
      groupsByJid.set(jid, {
        jid,
        name: String(group?.name ?? jid).trim() || jid,
        participants: Math.max(0, Number(group?.participants) || 0),
        source: 'socket',
      });
    }

    for (const entry of recoveredFromDb) {
      const jid = String(entry?.jid ?? '').trim();
      if (!jid) continue;

      if (isUserJid(jid)) {
        if (!contactsByJid.has(jid)) {
          contactsByJid.set(jid, {
            jid,
            name: String(entry?.name ?? jid).trim() || jid,
            source: 'db',
          });
        }
        continue;
      }

      if (isGroupJid(jid) && !groupsByJid.has(jid)) {
        groupsByJid.set(jid, {
          jid,
          name: String(entry?.name ?? jid).trim() || jid,
          participants: 0,
          source: 'db',
        });
      }
    }

    const contacts = [...contactsByJid.values()]
      .filter(target => targetMatchesSearch(target, normalizedSearch))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, maxLimit);

    const groups = [...groupsByJid.values()]
      .filter(target => targetMatchesSearch(target, normalizedSearch))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, maxLimit);

    return {
      contacts,
      groups,
      socketReady: Boolean(currentSocket),
      updatedAt: Date.now(),
    };
  }

  return {
    buildSetupConfigSnapshot,
    hydrateContactCacheFromDb,
    resolveContactDisplayName,
    listSetupSelectableTargets,
  };
}
