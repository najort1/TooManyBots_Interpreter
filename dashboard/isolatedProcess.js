import { DashboardServer } from './server.js';
import { getConfig } from '../config/index.js';
import { initDb, getContactDisplayName } from '../db/index.js';

const pendingRpc = new Map();
let rpcSequence = 1;
let stopping = false;
let dashboardServer = null;
let bridgeState = {
  runtimeInfo: {},
  flowBlocks: [],
};

function toPort(value, fallback = 8787) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  if (normalized <= 0 || normalized > 65535) return fallback;
  return normalized;
}

function resolveContactName(jid) {
  try {
    const name = String(getContactDisplayName(jid) || '').trim();
    return name || null;
  } catch {
    return null;
  }
}

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error('dashboard-bridge-no-parent'));
      return;
    }
    const id = rpcSequence++;
    const timeout = setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`dashboard-bridge-timeout:${method}`));
    }, 25000);

    pendingRpc.set(id, {
      resolve,
      reject,
      timeout,
      method,
    });

    process.send({
      type: 'dashboard-bridge-rpc-request',
      id,
      method,
      payload,
    });
  });
}

function resolveRpcResponse(message = {}) {
  const id = Number(message?.id);
  if (!Number.isFinite(id)) return;
  const pending = pendingRpc.get(id);
  if (!pending) return;
  pendingRpc.delete(id);
  clearTimeout(pending.timeout);

  if (message?.ok === true) {
    pending.resolve(message?.result);
    return;
  }
  pending.reject(new Error(String(message?.error || `${pending.method}-failed`)));
}

async function stopDashboardProcess(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const pending of pendingRpc.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('dashboard-bridge-stopped'));
  }
  pendingRpc.clear();

  try {
    await dashboardServer?.stop?.();
  } catch {
    // ignore shutdown issues
  } finally {
    process.exit(code);
  }
}

function createDashboardHandlers() {
  return {
    getRuntimeInfo: () => (
      bridgeState?.runtimeInfo && typeof bridgeState.runtimeInfo === 'object'
        ? bridgeState.runtimeInfo
        : {}
    ),
    getFlowBlocks: () => (
      Array.isArray(bridgeState?.flowBlocks)
        ? bridgeState.flowBlocks
        : []
    ),
    getContactName: jid => resolveContactName(jid),
    onReload: async () => rpc('onReload'),
    onHumanSendMessage: async payload => rpc('onHumanSendMessage', payload),
    onHumanSendImage: async payload => rpc('onHumanSendImage', payload),
    onHumanResumeSession: async payload => rpc('onHumanResumeSession', payload),
    onHumanEndSession: async payload => rpc('onHumanEndSession', payload),
    onBroadcastListContacts: async payload => rpc('onBroadcastListContacts', payload),
    onBroadcastSend: async payload => rpc('onBroadcastSend', payload),
    onBroadcastStatus: async () => rpc('onBroadcastStatus'),
    onBroadcastPause: async () => rpc('onBroadcastPause'),
    onBroadcastResume: async () => rpc('onBroadcastResume'),
    onBroadcastCancel: async () => rpc('onBroadcastCancel'),
    onGetSetupState: async () => rpc('onGetSetupState'),
    onApplySetupState: async payload => rpc('onApplySetupState', payload),
    onListSetupTargets: async payload => rpc('onListSetupTargets', payload),
    onGetSettings: async () => rpc('onGetSettings'),
    onUpdateSettings: async payload => rpc('onUpdateSettings', payload),
    onClearRuntimeCache: async () => rpc('onClearRuntimeCache'),
    onGetDbInfo: async () => rpc('onGetDbInfo'),
    onGetDbMaintenance: async () => rpc('onGetDbMaintenance'),
    onUpdateDbMaintenance: async payload => rpc('onUpdateDbMaintenance', payload),
    onRunDbMaintenance: async payload => rpc('onRunDbMaintenance', payload),
    onGetSessionManagementOverview: async () => rpc('onGetSessionManagementOverview'),
    onListSessionManagementFlows: async () => rpc('onListSessionManagementFlows'),
    onListActiveSessionsForManagement: async payload => rpc('onListActiveSessionsForManagement', payload),
    onClearActiveSessionsAll: async () => rpc('onClearActiveSessionsAll'),
    onClearActiveSessionsByFlow: async payload => rpc('onClearActiveSessionsByFlow', payload),
    onResetSessionsByJid: async payload => rpc('onResetSessionsByJid', payload),
    onUpdateFlowSessionTimeout: async payload => rpc('onUpdateFlowSessionTimeout', payload),
  };
}

process.on('message', message => {
  const type = String(message?.type || '').trim();
  if (!type) return;

  if (type === 'dashboard-bridge-state') {
    const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
    bridgeState = {
      runtimeInfo: payload.runtimeInfo && typeof payload.runtimeInfo === 'object' ? payload.runtimeInfo : {},
      flowBlocks: Array.isArray(payload.flowBlocks) ? payload.flowBlocks : [],
    };
    return;
  }

  if (type === 'dashboard-bridge-broadcast') {
    dashboardServer?.broadcast?.(message?.payload || {});
    return;
  }

  if (type === 'dashboard-bridge-rpc-response') {
    resolveRpcResponse(message);
    return;
  }

  if (type === 'dashboard-bridge-stop') {
    void stopDashboardProcess(0);
  }
});

process.on('disconnect', () => {
  void stopDashboardProcess(0);
});

process.on('SIGINT', () => {
  void stopDashboardProcess(0);
});

process.on('SIGTERM', () => {
  void stopDashboardProcess(0);
});

async function bootstrap() {
  const config = await getConfig({ interactive: false });
  initDb(config);

  const host = String(process.env.TMB_DASHBOARD_HOST || config?.dashboardHost || '127.0.0.1').trim() || '127.0.0.1';
  const port = toPort(process.env.TMB_DASHBOARD_PORT, Number(config?.dashboardPort || 8787));
  dashboardServer = new DashboardServer({
    host,
    port,
    logger: null,
    ...createDashboardHandlers(),
  });
  await dashboardServer.start();
  process.send?.({
    type: 'dashboard-bridge-ready',
    url: dashboardServer.getUrl(),
  });
}

bootstrap().catch(error => {
  process.send?.({
    type: 'dashboard-bridge-fatal',
    error: String(error?.message || error || 'dashboard-bridge-bootstrap-failed'),
  });
  void stopDashboardProcess(1);
});
