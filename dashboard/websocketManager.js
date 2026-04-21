import WebSocket, { WebSocketServer } from 'ws';
import { isWsImmediateEvent } from './serverMetricsUtils.js';

export function setupDashboardWebsocketServer(server, httpServer) {
  server.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  server.wss.on('connection', ws => {
    server.observability.ws.connectionsOpened += 1;
    server.getWsClientState(ws);
    ws.send(JSON.stringify({
      type: 'hello',
      now: Date.now(),
      capabilities: {
        subscribe: true,
        batchedEvents: true,
      },
    }));

    ws.on('message', rawMessage => {
      server.handleWsIncomingMessage(ws, rawMessage);
    });

    ws.on('close', () => {
      server.observability.ws.connectionsClosed += 1;
      const state = server.wsClientState.get(ws);
      if (state?.batchTimer) {
        clearTimeout(state.batchTimer);
        state.batchTimer = null;
      }
    });
  });
}

export function broadcastDashboardPayload(server, payload) {
  if (!server.wss) return;
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const immediate = isWsImmediateEvent(safePayload);
  for (const client of server.wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const state = server.getWsClientState(client);
    if (!server.shouldDeliverWsPayload(state, safePayload)) continue;
    if (immediate) {
      server.flushWsClientBatch(client);
      try {
        const wire = JSON.stringify({ type: 'event', payload: safePayload });
        client.send(wire);
        server.recordWsSend({
          bytes: Buffer.byteLength(wire, 'utf8'),
          events: 1,
          immediate: true,
        });
      } catch {
        // ignore socket send failures
      }
      continue;
    }
    server.queueWsPayload(client, safePayload);
  }
}

export function stopDashboardWebsocketServer(server) {
  if (!server.wss) return;
  for (const client of server.wss.clients) {
    const state = server.wsClientState.get(client);
    if (state?.batchTimer) {
      clearTimeout(state.batchTimer);
      state.batchTimer = null;
    }
  }
  server.wss.close();
  server.wss = null;
}
