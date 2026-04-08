import inquirer from 'inquirer';
import {
  fetchSavedTestTargetJidsFromDb,
  fetchSelectableContacts,
  fetchSelectableGroups,
  getAllowedTestJids,
  getGroupWhitelistJids,
  isGroupJid,
  isGroupWhitelistScope,
  isSelectableTestTargetJid,
  isUserJid,
  mergeContactCacheEntry,
  normalizeManualTargetJid,
  subscribeToRealtimeJidDiscovery,
  waitForContactCacheWarmup,
} from './contactUtils.js';

export async function configureRuntimeAccessSelectors(sock, flow, currentConfig, contactCache) {
  const nextConfig = { ...currentConfig };
  const startupChoice = String(currentConfig.__startupChoice ?? 'reconfigure');
  const shouldReconfigureNow = startupChoice !== 'use_previous';

  if (isGroupWhitelistScope(flow)) {
    const hasSavedWhitelist = getGroupWhitelistJids(currentConfig).size > 0;
    const shouldAskGroups = shouldReconfigureNow || !hasSavedWhitelist;

    if (shouldAskGroups) {
      const groups = await fetchSelectableGroups(sock);
      console.log(`[Setup] Grupos disponiveis para whitelist: ${groups.length}`);
      if (groups.length === 0) {
        console.warn('Nenhum grupo encontrado para configurar whitelist de grupos.');
        nextConfig.groupWhitelistJids = [];
      } else {
        const defaultSelections = Array.from(getGroupWhitelistJids(currentConfig));
        const { selectedGroups } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedGroups',
            message: 'Selecione os grupos em que o bot deve funcionar (whitelist):',
            choices: groups.map(group => ({
              name: `${group.name} (${group.participants} participantes) - ${group.jid}`,
              value: group.jid,
              checked: defaultSelections.includes(group.jid),
            })),
            pageSize: 20,
            validate: selected => (selected.length > 0 ? true : 'Selecione pelo menos 1 grupo.'),
          },
        ]);

        nextConfig.groupWhitelistJids = selectedGroups;
      }
    }
  }

  if (currentConfig.testMode) {
    const hasSavedTestTargets = getAllowedTestJids(currentConfig).size > 0;
    const shouldAskTestTargets = shouldReconfigureNow || !hasSavedTestTargets;

    if (shouldAskTestTargets) {
      const ACTION_REFRESH = '__refresh_realtime__';
      const ACTION_MANUAL = '__manual_jid_entry__';
      const selectedSet = getAllowedTestJids(currentConfig);
      const discoveredDuringSelection = new Set();

      const stopRealtimeDiscovery = subscribeToRealtimeJidDiscovery({
        sock,
        contactCache,
        onDiscoveredJid: jid => {
          if (isSelectableTestTargetJid(jid)) {
            discoveredDuringSelection.add(jid);
          }
        },
      });

      try {
        await waitForContactCacheWarmup(contactCache, 7000);

        while (true) {
          const contacts = await fetchSelectableContacts(contactCache);
          let groups = [];
          try {
            groups = await fetchSelectableGroups(sock);
          } catch {
            groups = [];
          }

          const savedFromDb = fetchSavedTestTargetJidsFromDb(contactCache);
          for (const item of savedFromDb) {
            discoveredDuringSelection.add(item.jid);
          }

          const knownContactJids = new Set(contacts.map(item => item.jid));
          const knownGroupJids = new Set(groups.map(item => item.jid));
          const additionalFromDbUsers = [];
          const additionalFromDbGroups = [];

          for (const entry of savedFromDb) {
            if (isUserJid(entry.jid) && !knownContactJids.has(entry.jid)) {
              additionalFromDbUsers.push({
                jid: entry.jid,
                name: entry.name || entry.jid,
              });
            } else if (isGroupJid(entry.jid) && !knownGroupJids.has(entry.jid)) {
              additionalFromDbGroups.push({
                jid: entry.jid,
                name: entry.name || entry.jid,
                participants: 0,
              });
            }
          }

          const additionalRealtimeUsers = [];
          const additionalRealtimeGroups = [];
          for (const jid of discoveredDuringSelection) {
            if (isUserJid(jid) && !knownContactJids.has(jid) && !additionalFromDbUsers.some(item => item.jid === jid)) {
              additionalRealtimeUsers.push({
                jid,
                name: contactCache.get(jid)?.name || jid,
              });
            } else if (isGroupJid(jid) && !knownGroupJids.has(jid) && !additionalFromDbGroups.some(item => item.jid === jid)) {
              additionalRealtimeGroups.push({
                jid,
                name: jid,
                participants: 0,
              });
            }
          }

          const allUsers = [...contacts, ...additionalFromDbUsers, ...additionalRealtimeUsers]
            .sort((a, b) => a.name.localeCompare(b.name));
          const allGroups = [...groups, ...additionalFromDbGroups, ...additionalRealtimeGroups]
            .sort((a, b) => a.name.localeCompare(b.name));

          console.log(
            `[Setup] Alvos de test mode: ${allUsers.length} contato(s), ${allGroups.length} grupo(s), ${savedFromDb.length} JID(s) recuperado(s) do banco`
          );

          const choices = [];
          if (allUsers.length > 0) {
            choices.push(new inquirer.Separator('--- Contatos ---'));
            for (const contact of allUsers) {
              choices.push({
                name: `${contact.name} - ${contact.jid}`,
                value: contact.jid,
                checked: selectedSet.has(contact.jid),
              });
            }
          }

          if (allGroups.length > 0) {
            choices.push(new inquirer.Separator('--- Grupos ---'));
            for (const group of allGroups) {
              const participantsLabel = Number(group.participants) > 0
                ? `${group.participants} participantes`
                : 'participantes desconhecidos';
              choices.push({
                name: `${group.name} (${participantsLabel}) - ${group.jid}`,
                value: group.jid,
                checked: selectedSet.has(group.jid),
              });
            }
          }

          choices.push(new inquirer.Separator('--- Acoes ---'));
          choices.push({
            name: 'Atualizar lista com JIDs detectados em tempo real',
            value: ACTION_REFRESH,
          });
          choices.push({
            name: 'Adicionar JID manualmente (fallback)',
            value: ACTION_MANUAL,
          });

          const { selectedTestTargets } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selectedTestTargets',
              message: 'Selecione contatos/grupos permitidos no modo Teste restrito:',
              choices,
              pageSize: 24,
              validate: selected => {
                const filtered = selected.filter(item => item !== ACTION_REFRESH && item !== ACTION_MANUAL);
                if (
                  filtered.length > 0 ||
                  selected.includes(ACTION_MANUAL) ||
                  selected.includes(ACTION_REFRESH)
                ) {
                  return true;
                }
                return 'Selecione pelo menos 1 alvo para teste, adicione manualmente, ou use Atualizar.';
              },
            },
          ]);

          const hasRefreshAction = selectedTestTargets.includes(ACTION_REFRESH);
          const hasManualAction = selectedTestTargets.includes(ACTION_MANUAL);
          const filteredSelection = selectedTestTargets.filter(item => item !== ACTION_REFRESH && item !== ACTION_MANUAL);

          if (hasRefreshAction && !hasManualAction && filteredSelection.length === 0) {
            console.log(
              `[Setup] Atualizacao solicitada. JIDs observados em tempo real nesta tela: ${discoveredDuringSelection.size}`
            );
            continue;
          }

          selectedSet.clear();
          for (const jid of filteredSelection) {
            selectedSet.add(jid);
          }

          if (hasManualAction) {
            const { manualJidsRaw } = await inquirer.prompt([
              {
                type: 'input',
                name: 'manualJidsRaw',
                message:
                  'Digite 1+ JIDs (separados por virgula). Ex: 5511999999999@s.whatsapp.net, 120363025746111111@g.us',
                validate: raw => {
                  const parts = String(raw ?? '')
                    .split(/[,\s;]+/)
                    .map(item => item.trim())
                    .filter(Boolean);
                  if (parts.length === 0) return 'Informe pelo menos 1 JID.';
                  const invalid = parts.filter(item => !normalizeManualTargetJid(item));
                  if (invalid.length > 0) {
                    return `JID invalido: ${invalid[0]}. Use @s.whatsapp.net (contato) ou @g.us (grupo).`;
                  }
                  return true;
                },
              },
            ]);

            const manualJids = String(manualJidsRaw ?? '')
              .split(/[,\s;]+/)
              .map(item => normalizeManualTargetJid(item))
              .filter(Boolean);

            for (const jid of manualJids) {
              selectedSet.add(jid);
              discoveredDuringSelection.add(jid);
              if (isUserJid(jid)) {
                mergeContactCacheEntry(contactCache, { id: jid });
              }
            }
          }

          if (hasRefreshAction) {
            console.log(
              `[Setup] Atualizacao solicitada. JIDs observados em tempo real nesta tela: ${discoveredDuringSelection.size}`
            );
            continue;
          }

          if (selectedSet.size === 0) {
            console.warn('Nenhum alvo selecionado. Desativando test mode restrito.');
            nextConfig.testMode = false;
            nextConfig.testJid = '';
            nextConfig.testJids = [];
          } else {
            const finalTargets = Array.from(selectedSet);
            nextConfig.testJids = finalTargets;
            nextConfig.testJid = finalTargets[0] ?? '';
          }
          break;
        }
      } finally {
        stopRealtimeDiscovery();
      }
    }
  }

  delete nextConfig.__startupChoice;
  return nextConfig;
}
