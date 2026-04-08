(function initDashboardMain(global) {
  const app = global.TmbDashboard;
  if (!app || !app.analytics || !app.handoff) return;

  const { state, els } = app;
  const { fmtUptime } = app.utils;

  async function initDashboard() {
    try {
      const healthRes = await fetch('/api/health');
      const health = await healthRes.json();

      state.currentMode = health.mode === 'command' ? 'COMMAND' : 'CONVERSATION';
      state.currentFlowPath = String(health.flowPath || '');
      els.botName.textContent = health.flowFile || 'Desconhecido';
      els.uptime.textContent = fmtUptime(health.uptimeMs || 0);

      if (state.currentMode === 'COMMAND') {
        els.modeBadge.innerHTML = '<i class="ph ph-lightning text-yellow-500"></i> MODO COMANDO';
        els.modeBadge.className = 'px-3 py-1 bg-yellow-100 text-yellow-800 rounded-md font-semibold flex items-center gap-2';
      } else {
        els.modeBadge.innerHTML = '<i class="ph ph-chat-circle text-blue-500"></i> MODO CONVERSACAO';
        els.modeBadge.className = 'px-3 py-1 bg-blue-100 text-blue-800 rounded-md font-semibold flex items-center gap-2';
      }

      els.bottomLeftCard.classList.remove('hidden');
      els.bottomRightCard.classList.remove('hidden');

      app.showView('analytics');
      app.setHandoffActionsEnabled(false);

      await app.analytics.refreshData();
      await app.handoff.loadHandoffBlocks();
      await app.handoff.refreshHandoffSessions();
      setupWebSocket();

      global.setInterval(() => {
        app.analytics.refreshData();
        app.handoff.refreshHandoffSessions();
      }, 30000);

      setupEventListeners();
    } catch (error) {
      console.error('Erro ao inicializar dashboard', error);
    }
  }

  function setupEventListeners() {
    document.getElementById('btn-reload').addEventListener('click', async () => {
      try {
        const btn = document.getElementById('btn-reload');
        const icon = btn.querySelector('i');
        if (icon) icon.classList.add('animate-spin');
        await fetch('/api/reload', { method: 'POST' });
        global.setTimeout(() => icon?.classList.remove('animate-spin'), 1000);
      } catch (error) {
        console.error('Erro ao recarregar flow', error);
      }
    });

    document.getElementById('btn-export').addEventListener('click', () => {
      global.open('/api/export?format=csv', '_blank');
    });

    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const btnOpenSidebar = document.getElementById('btn-open-sidebar');
    const btnCloseSidebar = document.getElementById('btn-close-sidebar');
    const btnGear = document.getElementById('btn-gear');

    function toggleSidebar() {
      sidebar.classList.toggle('hidden');
      backdrop.classList.toggle('hidden');
    }

    function openSettings() {
      if (global.innerWidth < 768 && sidebar.classList.contains('hidden')) {
        toggleSidebar();
      }
      app.setNavActive('settings');
      global.alert('Aqui entraria a tela de configuracoes do bot.');
    }

    btnOpenSidebar.addEventListener('click', toggleSidebar);
    btnCloseSidebar.addEventListener('click', toggleSidebar);
    backdrop.addEventListener('click', toggleSidebar);
    btnGear.addEventListener('click', openSettings);
    els.navSettings.addEventListener('click', event => {
      event.preventDefault();
      openSettings();
    });

    els.navDashboard.addEventListener('click', async event => {
      event.preventDefault();
      app.showView('analytics');
      await app.analytics.refreshData();
    });

    els.navHumanSupport.addEventListener('click', async event => {
      event.preventDefault();
      app.showView('handoff');
      await app.handoff.refreshHandoffSessions();
    });

    els.btnRefreshHandoff.addEventListener('click', () => {
      app.handoff.refreshHandoffSessions();
    });

    els.btnSendHandoff.addEventListener('click', () => {
      app.handoff.sendHandoffMessage();
    });

    els.handoffMessageInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        app.handoff.sendHandoffMessage();
      }
    });

    els.btnResumeHandoff.addEventListener('click', () => {
      app.handoff.resumeHandoffSession();
    });

    els.btnEndHandoff.addEventListener('click', () => {
      app.handoff.endHandoffSession();
    });
  }

  function setupWebSocket() {
    const scheme = global.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${global.location.host}/ws`);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'event' || !data.payload) return;

        if (state.currentFlowPath && data.payload.flowPath && data.payload.flowPath !== state.currentFlowPath) {
          return;
        }

        state.allLogs.push(data.payload);
        if (state.allLogs.length > 200) state.allLogs.shift();
        app.analytics.renderLogs();

        const payloadJid = String(data.payload?.jid || '').trim();
        if (payloadJid && state.selectedHandoffJid && payloadJid === state.selectedHandoffJid) {
          state.selectedHandoffHistory.push(data.payload);
          if (state.selectedHandoffHistory.length > 300) {
            state.selectedHandoffHistory.shift();
          }
          app.handoff.renderHandoffHistory();
        }

        if (data.payload.eventType && String(data.payload.eventType).includes('human-handoff')) {
          app.handoff.refreshHandoffSessions();
        }

        if ([
          'session-start',
          'session-end',
          'command-executed',
          'flow-error',
          'engine-error',
          'message-outgoing-error',
        ].includes(data.payload.eventType) || (data.payload.eventType === 'message-outgoing' && /^erro\b/i.test(String(data.payload.messageText || '')))) {
          global.clearTimeout(state.refreshTimeout);
          state.refreshTimeout = global.setTimeout(() => {
            app.analytics.refreshData();
            app.handoff.refreshHandoffSessions();
          }, 2000);
        }
      } catch (error) {
        console.error('WS Error', error);
      }
    };

    ws.onclose = () => {
      global.setTimeout(setupWebSocket, 3000);
    };
  }

  global.addEventListener('DOMContentLoaded', initDashboard);
})(window);
