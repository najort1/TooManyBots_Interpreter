(function initDashboardHandoff(global) {
  const app = global.TmbDashboard;
  if (!app) return;

  const { state, els } = app;
  const { fmtTime, escapeHtml } = app.utils;

  async function loadHandoffBlocks() {
    try {
      const response = await fetch('/api/handoff/blocks');
      const data = await response.json();
      state.handoffBlocks = Array.isArray(data?.blocks) ? data.blocks : [];
    } catch (error) {
      console.error('Falha ao carregar blocos para retomada', error);
      state.handoffBlocks = [];
    }

    const options = ['<option value="">Selecione bloco para retomar</option>'];
    for (const block of state.handoffBlocks) {
      const label = `#${block.index} · ${block.name || block.id} (${block.type})`;
      options.push(`<option value="${escapeHtml(block.id)}" data-index="${block.index}">${escapeHtml(label)}</option>`);
    }
    els.handoffResumeBlock.innerHTML = options.join('');
  }

  async function refreshHandoffSessions() {
    try {
      const response = await fetch('/api/handoff/sessions');
      const data = await response.json();
      state.handoffSessions = Array.isArray(data?.sessions) ? data.sessions : [];
      renderHandoffSessionsList();

      if (!state.selectedHandoffJid) return;
      const stillExists = state.handoffSessions.some(session => session.jid === state.selectedHandoffJid);
      if (!stillExists) {
        state.selectedHandoffJid = '';
        state.selectedHandoffHistory = [];
        renderHandoffHistory();
        app.setHandoffActionsEnabled(false);
        return;
      }

      if (state.currentView === 'handoff') {
        await loadSelectedHandoffHistory();
      }
    } catch (error) {
      console.error('Falha ao atualizar sessoes de handoff', error);
    }
  }

  function renderHandoffSessionsList() {
    if (!state.handoffSessions.length) {
      els.handoffSessionsList.innerHTML = '<div class="text-slate-400 text-center py-4">Nenhuma sessao aguardando atendimento.</div>';
      return;
    }

    els.handoffSessionsList.innerHTML = state.handoffSessions.map(session => {
      const selected = state.selectedHandoffJid === session.jid;
      const lastTime = session.lastActivityAt ? fmtTime(session.lastActivityAt) : '--:--';
      const snippet = session.lastMessage?.text ? escapeHtml(session.lastMessage.text).slice(0, 70) : 'Sem mensagem recente';
      const phone = String(session.jid || '').split('@')[0] || session.jid;
      return `
        <button data-handoff-jid="${escapeHtml(session.jid)}" class="w-full text-left border rounded p-2 transition ${selected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:border-slate-300 bg-white'}">
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold text-slate-800 text-xs">${escapeHtml(phone)}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Aguardando</span>
          </div>
          <div class="text-[11px] text-slate-500 mb-1">Fila: ${escapeHtml(session.queue || 'default')} · ${lastTime}</div>
          <div class="text-xs text-slate-600 truncate">${snippet}</div>
        </button>
      `;
    }).join('');

    els.handoffSessionsList.querySelectorAll('[data-handoff-jid]').forEach(button => {
      button.addEventListener('click', async () => {
        const jid = button.getAttribute('data-handoff-jid') || '';
        if (!jid) return;
        state.selectedHandoffJid = jid;
        renderHandoffSessionsList();
        await loadSelectedHandoffHistory();
        app.setHandoffActionsEnabled(true);
      });
    });
  }

  async function loadSelectedHandoffHistory() {
    if (!state.selectedHandoffJid) {
      state.selectedHandoffHistory = [];
      renderHandoffHistory();
      return;
    }

    try {
      const params = new URLSearchParams({ jid: state.selectedHandoffJid, limit: '200' });
      const response = await fetch(`/api/handoff/history?${params.toString()}`);
      const data = await response.json();
      state.selectedHandoffHistory = Array.isArray(data?.logs) ? data.logs : [];
    } catch (error) {
      console.error('Falha ao carregar historico de handoff', error);
      state.selectedHandoffHistory = [];
    }

    renderHandoffHistory();
  }

  function renderHandoffHistory() {
    if (!state.selectedHandoffJid) {
      els.handoffSelectedJid.textContent = 'Selecione uma sessao na lista';
      els.handoffChatHistory.innerHTML = '<div class="text-slate-400 text-center py-8">Selecione uma sessao para ver as mensagens.</div>';
      return;
    }

    const phone = String(state.selectedHandoffJid).split('@')[0] || state.selectedHandoffJid;
    els.handoffSelectedJid.textContent = `Sessao ativa: ${phone}`;

    if (!state.selectedHandoffHistory.length) {
      els.handoffChatHistory.innerHTML = '<div class="text-slate-400 text-center py-8">Sem historico para esta sessao.</div>';
      return;
    }

    const timeline = [...state.selectedHandoffHistory].sort((a, b) => (a.occurredAt || 0) - (b.occurredAt || 0));
    els.handoffChatHistory.innerHTML = timeline.map(event => {
      const eventType = String(event?.eventType || '').toLowerCase();
      const direction = String(event?.direction || '').toLowerCase();
      const isIncoming = direction === 'incoming' || eventType === 'message-incoming';
      const isOutgoing = direction === 'outgoing' || eventType === 'human-message-outgoing' || eventType === 'message-outgoing';
      const label = isIncoming ? 'Usuario' : (isOutgoing ? 'Atendente/Bot' : 'Sistema');
      const badgeClass = isIncoming ? 'bg-slate-200 text-slate-700' : (isOutgoing ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800');
      const text = escapeHtml(event?.messageText || `[${event?.eventType || 'evento'}]`);
      return `
        <div class="border border-slate-100 rounded bg-white px-3 py-2">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] px-2 py-0.5 rounded-full ${badgeClass}">${label}</span>
            <span class="text-[11px] text-slate-400">${fmtTime(event?.occurredAt || Date.now())}</span>
          </div>
          <div class="text-sm text-slate-700 break-words">${text}</div>
        </div>
      `;
    }).join('');

    els.handoffChatHistory.scrollTop = els.handoffChatHistory.scrollHeight;
  }

  async function sendHandoffMessage() {
    if (!state.selectedHandoffJid) return;
    const text = String(els.handoffMessageInput.value || '').trim();
    if (!text) return;

    els.btnSendHandoff.disabled = true;
    try {
      const response = await fetch('/api/handoff/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: state.selectedHandoffJid, text, agentId: 'dashboard-agent' }),
      });
      if (!response.ok) {
        throw new Error('Falha ao enviar mensagem do atendente');
      }
      els.handoffMessageInput.value = '';
      await loadSelectedHandoffHistory();
    } catch (error) {
      console.error(error);
      alert('Nao foi possivel enviar a mensagem agora.');
    } finally {
      els.btnSendHandoff.disabled = false;
    }
  }

  async function resumeHandoffSession() {
    if (!state.selectedHandoffJid) return;
    const targetBlockId = String(els.handoffResumeBlock.value || '').trim();
    if (!targetBlockId) {
      alert('Selecione um bloco para retomar a sessao.');
      return;
    }

    els.btnResumeHandoff.disabled = true;
    try {
      const response = await fetch('/api/handoff/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: state.selectedHandoffJid, targetBlockId, agentId: 'dashboard-agent' }),
      });
      if (!response.ok) {
        throw new Error('Falha ao retomar sessao');
      }

      await refreshHandoffSessions();
      await loadSelectedHandoffHistory();
    } catch (error) {
      console.error(error);
      alert('Nao foi possivel retomar a sessao.');
    } finally {
      els.btnResumeHandoff.disabled = false;
    }
  }

  async function endHandoffSession() {
    if (!state.selectedHandoffJid) return;
    const confirmed = global.confirm('Deseja encerrar esta sessao agora?');
    if (!confirmed) return;

    els.btnEndHandoff.disabled = true;
    try {
      const response = await fetch('/api/handoff/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: state.selectedHandoffJid, reason: 'human-agent-ended', agentId: 'dashboard-agent' }),
      });
      if (!response.ok) {
        throw new Error('Falha ao encerrar sessao');
      }

      state.selectedHandoffJid = '';
      state.selectedHandoffHistory = [];
      app.setHandoffActionsEnabled(false);
      await refreshHandoffSessions();
      renderHandoffHistory();
    } catch (error) {
      console.error(error);
      alert('Nao foi possivel encerrar a sessao.');
    } finally {
      els.btnEndHandoff.disabled = false;
    }
  }

  app.handoff = {
    loadHandoffBlocks,
    refreshHandoffSessions,
    renderHandoffSessionsList,
    loadSelectedHandoffHistory,
    renderHandoffHistory,
    sendHandoffMessage,
    resumeHandoffSession,
    endHandoffSession,
  };
})(window);
