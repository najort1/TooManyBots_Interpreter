(function initDashboardShared(global) {
  const app = global.TmbDashboard = global.TmbDashboard || {};

  app.state = {
    currentMode: 'CONVERSATION',
    currentFlowPath: '',
    currentView: 'analytics',
    charts: {},
    allLogs: [],
    handoffSessions: [],
    handoffBlocks: [],
    selectedHandoffJid: '',
    selectedHandoffHistory: [],
    refreshTimeout: null,
  };

  app.els = {
    modeBadge: document.getElementById('mode-badge'),
    botName: document.getElementById('bot-name'),
    uptime: document.getElementById('uptime'),
    analyticsView: document.getElementById('analytics-view'),
    handoffView: document.getElementById('handoff-view'),
    navDashboard: document.getElementById('nav-dashboard'),
    navHumanSupport: document.getElementById('nav-human-support'),
    navSettings: document.getElementById('nav-settings'),
    kpiCards: document.getElementById('kpi-cards'),
    primaryChartTitle: document.getElementById('primary-chart-title'),
    secondaryChartTitle: document.getElementById('secondary-chart-title'),
    listTitle: document.getElementById('list-title'),
    rankingList: document.getElementById('ranking-list'),
    logsTitle: document.getElementById('logs-title'),
    logsContainer: document.getElementById('logs-container'),
    bottomLeftCard: document.getElementById('bottom-left-card'),
    bottomLeftTitle: document.getElementById('bottom-left-title'),
    bottomRightCard: document.getElementById('bottom-right-card'),
    bottomRightTitle: document.getElementById('bottom-right-title'),
    statusList: document.getElementById('status-list'),
    handoffSessionsList: document.getElementById('handoff-sessions-list'),
    handoffSelectedJid: document.getElementById('handoff-selected-jid'),
    handoffChatHistory: document.getElementById('handoff-chat-history'),
    handoffMessageInput: document.getElementById('handoff-message-input'),
    btnSendHandoff: document.getElementById('btn-send-handoff'),
    btnResumeHandoff: document.getElementById('btn-resume-handoff'),
    btnEndHandoff: document.getElementById('btn-end-handoff'),
    btnRefreshHandoff: document.getElementById('btn-refresh-handoff'),
    handoffResumeBlock: document.getElementById('handoff-resume-block'),
  };

  app.navActiveClass = 'flex items-center gap-3 px-3 py-2 bg-blue-50 text-blue-700 rounded-md font-medium transition-colors';
  app.navDefaultClass = 'flex items-center gap-3 px-3 py-2 text-slate-600 hover:bg-slate-50 rounded-md font-medium transition-colors';

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('pt-BR');
  }

  function fmtDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.round(sec / 60)}m ${sec % 60}s`;
  }

  function fmtUptime(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setNavActive(target) {
    const { els } = app;
    const map = {
      dashboard: els.navDashboard,
      handoff: els.navHumanSupport,
      settings: els.navSettings,
    };

    Object.values(map).forEach(link => {
      if (!link) return;
      link.className = app.navDefaultClass;
    });

    if (map[target]) {
      map[target].className = app.navActiveClass;
    }
  }

  function showView(nextView) {
    const { state, els } = app;
    state.currentView = nextView;
    const showAnalytics = nextView === 'analytics';
    els.analyticsView.classList.toggle('hidden', !showAnalytics);
    els.handoffView.classList.toggle('hidden', showAnalytics);
    setNavActive(showAnalytics ? 'dashboard' : 'handoff');
  }

  function setHandoffActionsEnabled(enabled) {
    const { els } = app;
    els.btnSendHandoff.disabled = !enabled;
    els.btnResumeHandoff.disabled = !enabled;
    els.btnEndHandoff.disabled = !enabled;
    els.handoffResumeBlock.disabled = !enabled;
  }

  app.utils = {
    fmtTime,
    fmtDuration,
    fmtUptime,
    escapeHtml,
  };
  app.setNavActive = setNavActive;
  app.showView = showView;
  app.setHandoffActionsEnabled = setHandoffActionsEnabled;
})(window);
