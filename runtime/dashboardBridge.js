import path from 'path';
import { spawn } from 'node:child_process';

function stringifyError(error, fallback = 'unknown-error') {
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
}

export function openDashboardInBrowser(url) {
  if (String(process.env.TMB_DASHBOARD_AUTO_OPEN ?? '1') === '0') return false;
  if (!process.stdout?.isTTY) return false;

  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

export function createDashboardBridgeController({ getLogger, getRuntimeInfo, getFlowBlocks } = {}) {
  let isolatedProcess = null;
  let stateSyncTimer = null;
  let rpcHandlers = null;

  const resolveLogger = () => {
    if (typeof getLogger === 'function') {
      return getLogger();
    }
    return null;
  };

  function stopDashboardStateSync() {
    if (!stateSyncTimer) return;
    clearInterval(stateSyncTimer);
    stateSyncTimer = null;
  }

  function setRpcHandlers(handlers) {
    rpcHandlers = handlers || null;
  }

  function sendDashboardBridgeState() {
    if (!isolatedProcess || !isolatedProcess.connected || !rpcHandlers) return;
    try {
      const runtimeInfo = typeof getRuntimeInfo === 'function'
        ? getRuntimeInfo()
        : (typeof rpcHandlers.getRuntimeInfo === 'function' ? rpcHandlers.getRuntimeInfo() : {});
      const flowBlocks = typeof getFlowBlocks === 'function'
        ? getFlowBlocks()
        : (typeof rpcHandlers.getFlowBlocks === 'function' ? rpcHandlers.getFlowBlocks() : []);
      isolatedProcess.send({
        type: 'dashboard-bridge-state',
        payload: {
          runtimeInfo: runtimeInfo || {},
          flowBlocks: Array.isArray(flowBlocks) ? flowBlocks : [],
        },
      });
    } catch (error) {
      resolveLogger()?.warn?.(
        { error: stringifyError(error, 'dashboard-bridge-state-failed') },
        'Failed to sync dashboard bridge state'
      );
    }
  }

  async function handleDashboardProcessRpcRequest(message = {}) {
    const processRef = isolatedProcess;
    if (!processRef || !processRef.connected) return;

    const id = Number(message?.id);
    const method = String(message?.method || '').trim();
    const payload = message?.payload;
    if (!Number.isFinite(id) || !method) return;

    const handler = rpcHandlers?.[method];
    if (typeof handler !== 'function') {
      processRef.send({
        type: 'dashboard-bridge-rpc-response',
        id,
        ok: false,
        error: `unknown-method:${method}`,
      });
      return;
    }

    try {
      const result = await handler(payload);
      processRef.send({
        type: 'dashboard-bridge-rpc-response',
        id,
        ok: true,
        result,
      });
    } catch (error) {
      processRef.send({
        type: 'dashboard-bridge-rpc-response',
        id,
        ok: false,
        error: stringifyError(error, 'dashboard-rpc-failed'),
      });
    }
  }

  async function stopDashboardIsolatedProcess() {
    stopDashboardStateSync();
    const processRef = isolatedProcess;
    isolatedProcess = null;
    rpcHandlers = null;
    if (!processRef) return;

    await new Promise(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };

      processRef.once('exit', finish);

      try {
        if (processRef.connected) {
          processRef.send({ type: 'dashboard-bridge-stop' });
        }
      } catch {
        // ignore
      }

      setTimeout(() => {
        if (finished) return;
        try {
          processRef.kill();
        } catch {
          // ignore
        }
      }, 1500);

      setTimeout(finish, 3000);
    });
  }

  async function startDashboardIsolatedProcess({
    handlers = {},
    host = '127.0.0.1',
    port = 8787,
    childScript = path.resolve('./dashboard/isolatedProcess.js'),
    publicUrl = `http://${host}:${port}`,
  } = {}) {
    await stopDashboardIsolatedProcess();
    rpcHandlers = handlers;

    const child = spawn(process.execPath, [childScript], {
      env: {
        ...process.env,
        TMB_DASHBOARD_HOST: String(host || '127.0.0.1'),
        TMB_DASHBOARD_PORT: String(Number(port || 8787)),
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    isolatedProcess = child;

    child.on('message', message => {
      const type = String(message?.type || '').trim();
      if (type === 'dashboard-bridge-rpc-request') {
        void handleDashboardProcessRpcRequest(message);
      }
    });

    child.on('exit', code => {
      if (isolatedProcess === child) {
        isolatedProcess = null;
        stopDashboardStateSync();
      }
      resolveLogger()?.warn?.(
        { code: Number(code ?? 0) || 0 },
        'Isolated dashboard process exited'
      );
    });

    const readyUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('dashboard-bridge-timeout'));
      }, 15000);
      const onMessage = message => {
        const type = String(message?.type || '').trim();
        if (type === 'dashboard-bridge-ready') {
          clearTimeout(timeout);
          child.off('message', onMessage);
          child.off('exit', onExit);
          resolve(String(message?.url || publicUrl));
          return;
        }
        if (type === 'dashboard-bridge-fatal') {
          clearTimeout(timeout);
          child.off('message', onMessage);
          child.off('exit', onExit);
          reject(new Error(String(message?.error || 'dashboard-bridge-fatal')));
        }
      };
      const onExit = code => {
        clearTimeout(timeout);
        child.off('message', onMessage);
        reject(new Error(`dashboard-bridge-exit:${String(code ?? 'unknown')}`));
      };

      child.on('message', onMessage);
      child.once('exit', onExit);
    });

    sendDashboardBridgeState();
    stateSyncTimer = setInterval(() => {
      sendDashboardBridgeState();
    }, 1500);
    if (typeof stateSyncTimer.unref === 'function') {
      stateSyncTimer.unref();
    }

    return String(readyUrl || publicUrl);
  }

  function broadcastDashboardEvent(event = {}, dashboardServer = null) {
    if (dashboardServer) {
      dashboardServer.broadcast(event);
    }
    if (isolatedProcess && isolatedProcess.connected) {
      try {
        isolatedProcess.send({
          type: 'dashboard-bridge-broadcast',
          payload: event,
        });
      } catch (error) {
        resolveLogger()?.debug?.(
          { error: stringifyError(error) },
          'Failed to relay event to isolated dashboard process'
        );
      }
    }
  }

  return {
    setRpcHandlers,
    sendDashboardBridgeState,
    stopDashboardStateSync,
    stopDashboardIsolatedProcess,
    startDashboardIsolatedProcess,
    broadcastDashboardEvent,
  };
}
