(function initDashboardAnalytics(global) {
  const app = global.TmbDashboard;
  if (!app) return;

  const { state, els } = app;
  const { fmtTime, fmtDuration } = app.utils;

  async function refreshData() {
    const modeParam = state.currentMode === 'COMMAND' ? 'command' : 'conversation';
    try {
      const statsRes = await fetch(`/api/stats?mode=${modeParam}&period=today`);
      const stats = await statsRes.json();

      renderKPIs(stats);
      renderPrimaryChart(stats);
      renderVolumeChart(stats);
      renderRanking(stats);
      renderBottomCards(stats);

      if (state.allLogs.length === 0) {
        const logsRes = await fetch(`/api/logs?limit=50&mode=${modeParam}`);
        const logsData = await logsRes.json();
        state.allLogs = (logsData.logs || []).reverse();
        renderLogs();
      }
    } catch (error) {
      console.error('Falha ao obter stats', error);
    }
  }

  function renderKPIs(stats) {
    if (state.currentMode === 'CONVERSATION') {
      els.kpiCards.innerHTML = `
        <div class="card flex flex-col items-center justify-center p-4">
          <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
            <i class="ph ph-chat-teardrop"></i> Conversas
          </div>
          <div class="text-3xl font-black text-slate-800">${stats.conversationsStarted || 0}</div>
          <div class="text-xs text-slate-400 mt-1">Hoje</div>
        </div>
        <div class="card flex flex-col items-center justify-center p-4">
          <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
            <i class="ph ph-user-minus"></i> Abandono
          </div>
          <div class="text-3xl font-black text-red-500">${((stats.abandonmentRate || 0) * 100).toFixed(1)}%</div>
          <div class="text-xs text-slate-400 mt-1">Taxa</div>
        </div>
        <div class="card flex flex-col items-center justify-center p-4">
          <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
            <i class="ph ph-clock"></i> Tempo Medio
          </div>
          <div class="text-3xl font-black text-blue-500">${fmtDuration(stats.avgDurationMs || 0)}</div>
          <div class="text-xs text-slate-400 mt-1">Duracao</div>
        </div>
        <div class="card flex flex-col items-center justify-center p-4">
          <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
            <i class="ph ph-activity"></i> Sessoes Ativas
          </div>
          <div class="text-3xl font-black text-green-500">${stats.activeSessions || 0}</div>
          <div class="text-xs text-slate-400 mt-1">Agora</div>
        </div>
      `;
      return;
    }

    els.kpiCards.innerHTML = `
      <div class="card flex flex-col items-center justify-center p-4">
        <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
          <i class="ph ph-lightning"></i> Execucoes
        </div>
        <div class="text-3xl font-black text-slate-800">${stats.totalExecutions || 0}</div>
        <div class="text-xs text-slate-400 mt-1">Hoje</div>
      </div>
      <div class="card flex flex-col items-center justify-center p-4">
        <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
          <i class="ph ph-timer"></i> Latencia
        </div>
        <div class="text-3xl font-black text-yellow-600">${stats.avgLatencyMs || 0}ms</div>
        <div class="text-xs text-slate-400 mt-1">Media API</div>
      </div>
      <div class="card flex flex-col items-center justify-center p-4">
        <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
          <i class="ph ph-check-circle"></i> Sucesso
        </div>
        <div class="text-3xl font-black text-green-500">${((stats.successRate || 0) * 100).toFixed(1)}%</div>
        <div class="text-xs text-slate-400 mt-1">Taxa</div>
      </div>
      <div class="card flex flex-col items-center justify-center p-4">
        <div class="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
          <i class="ph ph-trend-up"></i> Pico
        </div>
        <div class="text-3xl font-black text-indigo-500">${stats.peakPerHour || 0}</div>
        <div class="text-xs text-slate-400 mt-1">/hora</div>
      </div>
    `;
  }

  function renderPrimaryChart(stats) {
    const ctx = document.getElementById('primaryChart').getContext('2d');

    if (state.currentMode === 'CONVERSATION') {
      els.primaryChartTitle.innerHTML = '<i class="ph ph-funnel text-blue-500"></i> Funil de Conversao';
      const funnelData = stats.funnel || [{ step: 'initial', count: stats.conversationsStarted || 0, label: 'Inicio' }];
      const labels = funnelData.map(item => item.label);
      const data = funnelData.map(item => item.count);

      if (state.charts.primary) {
        state.charts.primary.data.labels = labels;
        state.charts.primary.data.datasets[0].data = data;
        state.charts.primary.update('none');
        return;
      }

      state.charts.primary = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Usuarios na etapa',
            data,
            backgroundColor: 'rgba(59, 130, 246, 0.8)',
            borderRadius: 4,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true } },
        },
      });
      return;
    }

    els.primaryChartTitle.innerHTML = '<i class="ph ph-chart-pie-slice text-yellow-500"></i> Comandos Populares';
    const cmds = stats.commands || [];
    const labels = cmds.map(c => c.command);
    const data = cmds.map(c => c.count);
    const bgColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

    if (state.charts.primary) {
      state.charts.primary.data.labels = labels;
      state.charts.primary.data.datasets[0].data = data;
      state.charts.primary.data.datasets[0].backgroundColor = bgColors.slice(0, data.length);
      state.charts.primary.update('none');
      return;
    }

    state.charts.primary = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors.slice(0, data.length),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } },
        cutout: '65%',
      },
    });
  }

  function renderVolumeChart(stats) {
    const ctx = document.getElementById('volumeChart').getContext('2d');
    const hourlyData = stats.hourlyVolume || Array(24).fill(0);
    const labels = Array.from({ length: 24 }, (_, i) => `${i}h`);

    if (state.charts.volume) {
      state.charts.volume.data.datasets[0].data = hourlyData;
      state.charts.volume.update('none');
      return;
    }

    state.charts.volume = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Volume',
          data: hourlyData,
          borderColor: state.currentMode === 'CONVERSATION' ? '#3b82f6' : '#8b5cf6',
          backgroundColor: state.currentMode === 'CONVERSATION' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(139, 92, 246, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, display: false },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function renderRanking(stats) {
    if (state.currentMode === 'CONVERSATION') {
      els.listTitle.innerHTML = '<i class="ph ph-users text-blue-500"></i> Contatos Mais Ativos';
      const contacts = stats.topContacts || [];
      if (contacts.length === 0) {
        els.rankingList.innerHTML = '<div class="text-center text-slate-400 py-6">Nenhum dado ainda</div>';
        return;
      }

      els.rankingList.innerHTML = contacts.map((c, i) => `
        <div class="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
              ${i + 1}
            </div>
            <div>
              <div class="font-semibold text-slate-800 text-sm truncate w-32">${c.name || c.jid}</div>
              <div class="text-xs text-slate-500">Ultima: ${fmtTime(c.lastActivity || Date.now())}</div>
            </div>
          </div>
          <div class="text-right">
            <div class="font-bold text-slate-700 text-sm">${c.messageCount}</div>
            <div class="text-xs text-slate-400">msgs</div>
          </div>
        </div>
      `).join('');
      return;
    }

    els.listTitle.innerHTML = '<i class="ph ph-users text-yellow-500"></i> Usuarios Mais Ativos';
    const users = stats.topUsers || [];
    if (users.length === 0) {
      els.rankingList.innerHTML = '<div class="text-center text-slate-400 py-6">Nenhum dado ainda</div>';
      return;
    }

    els.rankingList.innerHTML = users.map(user => `
      <div class="py-3 border-b border-slate-100 last:border-0">
        <div class="flex items-center justify-between mb-1">
          <div class="font-bold text-sm text-slate-800">${user.name || user.jid}</div>
          <div class="text-xs font-bold text-slate-600">${user.totalCommands} cmd</div>
        </div>
        <div class="flex items-center justify-between text-xs text-slate-500">
          <div>Favorito: <span class="font-mono text-indigo-600 bg-indigo-50 px-1 rounded">${user.favoriteCommand}</span></div>
        </div>
      </div>
    `).join('');
  }

  function renderLogs() {
    if (state.currentMode === 'CONVERSATION') {
      els.logsTitle.innerHTML = '<i class="ph ph-chats-circle text-blue-500"></i> Conversas em Tempo Real';
      if (state.allLogs.length === 0) {
        els.logsContainer.innerHTML = '<div class="text-center text-slate-400 py-6">Aguardando mensagens...</div>';
        return;
      }

      els.logsContainer.innerHTML = state.allLogs.map(log => {
        const isBot = log.direction === 'outgoing';
        const msg = log.messageText || (log.eventType === 'session-start' ? '[Sessao iniciada]' : '[Evento de sistema]');
        const icon = isBot ? 'Bot' : (log.jid ? log.jid.split('@')[0].slice(-4) : 'User');
        return `
          <div class="flex gap-3 mb-2 ${isBot ? 'bg-slate-100 p-2 rounded-r-lg rounded-bl-lg' : ''}">
            <div class="text-slate-400 text-xs shrink-0 w-16 pt-1">${fmtTime(log.occurredAt)}</div>
            <div class="flex-grow">
              <span class="font-bold text-xs ${isBot ? 'text-blue-600' : 'text-slate-700'}">${icon}:</span>
              <span class="text-slate-600 ml-1 text-sm break-words">${msg}</span>
            </div>
          </div>
        `;
      }).join('');
    } else {
      els.logsTitle.innerHTML = '<i class="ph ph-list-dashes text-yellow-500"></i> Logs de Comandos';
      els.logsContainer.innerHTML = `
        <table class="w-full text-left text-xs text-slate-600">
          <thead class="text-slate-400 sticky top-0 bg-slate-50 border-b border-slate-200">
            <tr>
              <th class="pb-2 font-medium">Hora</th>
              <th class="pb-2 font-medium">JID</th>
              <th class="pb-2 font-medium">Comando</th>
              <th class="pb-2 font-medium text-right">Res</th>
            </tr>
          </thead>
          <tbody>
            ${state.allLogs.map(log => {
              const cmd = log.metadata?.commandName || (log.messageText ? log.messageText.split(' ')[0] : 'n/a');
              const success = log.metadata?.success !== false;
              const resIcon = success ? 'OK' : 'ERRO';
              return `
                <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-100">
                  <td class="py-2">${fmtTime(log.occurredAt)}</td>
                  <td class="py-2 truncate max-w-[80px]">${log.jid || 'n/a'}</td>
                  <td class="py-2 font-mono text-indigo-600">${cmd}</td>
                  <td class="py-2 text-right">${resIcon}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    els.logsContainer.scrollTop = els.logsContainer.scrollHeight;
  }

  function renderBottomCards(stats) {
    if (state.currentMode === 'CONVERSATION') {
      els.bottomLeftTitle.innerHTML = '<i class="ph ph-calendar-blank text-orange-500"></i> Tendencia Semanal';
      els.bottomRightTitle.innerHTML = '<i class="ph ph-chart-line-up text-teal-500"></i> Metricas Avancadas';

      const ctx = document.getElementById('bottomChart').getContext('2d');
      const trend = stats.weeklyTrend || [];
      const labels = trend.length ? trend.map(t => t.date) : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
      const dataStarted = trend.length ? trend.map(t => t.started) : [12, 19, 15, 25, 22, 10, 8];
      const dataAbandoned = trend.length ? trend.map(t => t.abandoned) : [3, 5, 2, 8, 4, 1, 1];

      if (state.charts.bottom) {
        state.charts.bottom.data.labels = labels;
        state.charts.bottom.data.datasets[0].data = dataStarted;
        state.charts.bottom.data.datasets[1].data = dataAbandoned;
        state.charts.bottom.update('none');
      } else {
        state.charts.bottom = new Chart(ctx, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Conversas', data: dataStarted, backgroundColor: '#3b82f6' },
              { label: 'Abandonos', data: dataAbandoned, backgroundColor: '#ef4444' },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { stacked: true },
              y: { stacked: true, beginAtZero: true },
            },
          },
        });
      }

      const started = Number(stats.conversationsStarted || 0);
      const completed = Number(stats.completedSessions || 0);
      const abandoned = Number(stats.abandonedSessions || 0);
      const conversionRate = started > 0 ? (completed / started) * 100 : 0;

      els.statusList.innerHTML = `
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-slate-50 p-3 rounded border border-slate-100">
            <div class="text-xs text-slate-500 mb-1">Taxa de Conversao</div>
            <div class="font-bold text-lg text-slate-800">${conversionRate.toFixed(1)}%</div>
          </div>
          <div class="bg-slate-50 p-3 rounded border border-slate-100">
            <div class="text-xs text-slate-500 mb-1">Tempo Mediano</div>
            <div class="font-bold text-lg text-slate-800">${fmtDuration(stats.medianDurationMs || 38000)}</div>
          </div>
          <div class="bg-slate-50 p-3 rounded border border-slate-100">
            <div class="text-xs text-slate-500 mb-1">Concluidas</div>
            <div class="font-bold text-lg text-slate-800">${completed}</div>
          </div>
          <div class="bg-slate-50 p-3 rounded border border-slate-100">
            <div class="text-xs text-slate-500 mb-1">Abandonadas</div>
            <div class="font-bold text-lg text-slate-800">${abandoned}</div>
          </div>
        </div>
      `;
      return;
    }

    els.bottomLeftTitle.innerHTML = '<i class="ph ph-warning-circle text-red-500"></i> Erros e Alertas';
    els.bottomRightTitle.innerHTML = '<i class="ph ph-heartbeat text-green-500"></i> Saude das APIs';

    const errors = stats.recentErrors || [];
    const ctxContainer = document.getElementById('bottomChart').parentElement;
    ctxContainer.innerHTML = errors.length === 0
      ? '<div class="text-center text-slate-400 py-6">Nenhum erro recente</div>'
      : errors.map(error => `
          <div class="flex items-center gap-3 p-2 bg-red-50 border border-red-100 rounded mb-2">
            <div class="w-2 h-2 rounded-full bg-red-500"></div>
            <div class="font-mono text-sm text-red-800">${error.command}</div>
            <div class="text-sm text-slate-600 flex-grow">${error.error}</div>
            <div class="text-xs font-bold text-slate-500">${error.count}x</div>
          </div>
        `).join('');

    const health = stats.apiHealth || [
      { name: 'Sistema Base', avgLatencyMs: stats.avgLatencyMs || 0, uptime: 1.0, status: 'healthy' },
    ];

    els.statusList.innerHTML = health.map(item => `
      <div class="flex items-center justify-between p-3 border-b border-slate-100 last:border-0">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full ${item.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}"></div>
          <div class="font-semibold text-sm text-slate-800">${item.name}</div>
        </div>
        <div class="flex gap-4 text-xs font-medium text-slate-600">
          <span>${item.avgLatencyMs}ms</span>
          <span>${(item.uptime * 100).toFixed(0)}% OK</span>
        </div>
      </div>
    `).join('');
  }

  app.analytics = {
    refreshData,
    renderKPIs,
    renderPrimaryChart,
    renderVolumeChart,
    renderRanking,
    renderLogs,
    renderBottomCards,
  };
})(window);
