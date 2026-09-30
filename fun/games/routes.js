/**
 * Rotas HTTP e Server-Sent Events (SSE) para os Jogos Multiplayer de Panelinhas.
 * Integrado ao servidor HTTP do dashboard (porta 8790) e acessível via Quick Tunnel / Next.js rewrites.
 */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Game-Token');
  res.writeHead(status);
  res.end(payload);
}

export function createGameRoutes({
  gameManager,
  authService,
  authorizeCreateRoom = () => false,
  readBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  },
} = {}) {
  if (!gameManager) throw new Error('[gameRoutes] gameManager é obrigatório');
  if (!authService) throw new Error('[gameRoutes] authService é obrigatório');

  /**
   * Trata requisições que iniciam com `/api/fun/games/`.
   * Retorna `true` se a requisição foi tratada, ou `false` se não correspondeu a nenhuma rota de jogo.
   */
  async function handleRequest(req, res, url) {
    const path = url.pathname;

    if (!path.startsWith('/api/fun/games')) {
      return false;
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Game-Token');
      res.writeHead(204);
      res.end();
      return true;
    }

    // 0. POST /api/fun/games/create
    // Criação sob demanda exclusiva do script local de testes.
    if (req.method === 'POST' && path === '/api/fun/games/create') {
      if (!authorizeCreateRoom(req)) {
        sendJson(res, 403, { ok: false, error: 'test_room_creation_forbidden' });
        return true;
      }

      try {
        const body = await readBody(req);
        const {
          gameType = 'quiz_royale',
          scopeKey = '120363020000000000@g.us',
          prize = 1000,
          startInMinutes = 3,
        } = body || {};

        const result = await gameManager.createRoom({
          scopeKey,
          gameType,
          prize,
          startInMinutes,
        });

        sendJson(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        console.error('[gameRoutes] Erro ao criar sala via API:', err);
        sendJson(res, 500, { ok: false, error: 'create_room_failed', message: err?.message || 'Falha ao criar sala' });
        return true;
      }
    }

    // 1. POST /api/fun/games/auth/login
    // Login com usuário + senha e verificação automática da panelinha
    if (req.method === 'POST' && path === '/api/fun/games/auth/login') {
      try {
        const body = await readBody(req);
        const { username, password, roomId } = body || {};

        if (!roomId) {
          sendJson(res, 400, { ok: false, error: 'missing_room_id', message: 'ID da sala não fornecido.' });
          return true;
        }

        const room = gameManager.getRoom(roomId);
        if (!room) {
          sendJson(res, 404, { ok: false, error: 'room_not_found', message: 'Sala não encontrada ou já encerrada.' });
          return true;
        }

        const loginResult = await authService.login({
          username,
          password,
          scopeKey: room.scopeKey,
        });

        if (!loginResult.ok) {
          const status = loginResult.error === 'rate_limited'
            ? 429
            : loginResult.error === 'no_faction'
              ? 403
              : 401;
          sendJson(res, status, loginResult);
          return true;
        }

        // Coloca o jogador na sala
        const playerPayload = loginResult.player || loginResult;
        const joinResult = gameManager.joinRoom(roomId, playerPayload);
        if (!joinResult.ok) {
          sendJson(res, 400, joinResult);
          return true;
        }

        sendJson(res, 200, {
          ok: true,
          token: loginResult.token,
          player: loginResult.player,
          room: joinResult.room,
        });
        return true;
      } catch (err) {
        console.error('[gameRoutes] Erro no login:', err);
        sendJson(res, 500, { ok: false, error: 'internal_error', message: 'Erro ao processar autenticação.' });
        return true;
      }
    }

    // 2. GET /api/fun/games/room/:roomId
    // Consulta status público da sala
    const roomMatch = path.match(/^\/api\/fun\/games\/room\/([^/]+)$/);
    if (req.method === 'GET' && roomMatch) {
      const roomId = decodeURIComponent(roomMatch[1]);
      const room = gameManager.getRoom(roomId);
      if (!room) {
        sendJson(res, 404, { ok: false, error: 'room_not_found', message: 'Sala não encontrada.' });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        room: gameManager.publicRoomState(room),
      });
      return true;
    }

    // 3. GET /api/fun/games/events/:roomId
    // Stream de Server-Sent Events (SSE) para atualização em tempo real
    const eventsMatch = path.match(/^\/api\/fun\/games\/events\/([^/]+)$/);
    if (req.method === 'GET' && eventsMatch) {
      const roomId = decodeURIComponent(eventsMatch[1]);
      const room = gameManager.getRoom(roomId);
      if (!room) {
        sendJson(res, 404, { ok: false, error: 'room_not_found', message: 'Sala não encontrada.' });
        return true;
      }

      // Headers obrigatórios para SSE através do Cloudflare Quick Tunnel
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.writeHead(200);

      // Adiciona o client na sala
      room.clients.add(res);

      // Envia imediatamente o estado atual
      const initPayload = JSON.stringify({
        type: 'initial_state',
        room: gameManager.publicRoomState(room),
      });
      res.write(`event: init\ndata: ${initPayload}\n\n`);

      const cleanupClient = () => {
        room.clients.delete(res);
      };
      if (typeof req?.on === 'function') {
        req.on('close', cleanupClient);
        req.on('error', cleanupClient);
      }
      if (typeof res?.on === 'function') {
        res.on('close', cleanupClient);
        res.on('error', cleanupClient);
      }
      return true;
    }

    // 4. POST /api/fun/games/action/:roomId
    // Envio de ação de jogo (movimento, resposta do quiz, habilidade, etc.)
    const actionMatch = path.match(/^\/api\/fun\/games\/action\/([^/]+)$/);
    if (req.method === 'POST' && actionMatch) {
      try {
        const roomId = decodeURIComponent(actionMatch[1]);
        const body = await readBody(req);

        // Extrai token do header ou do body
        const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        const headerToken = String(req.headers['x-game-token'] || '').trim();
        const token = authHeader || headerToken || body?.token;

        const playerSession = authService.resolveToken(token);
        if (!playerSession) {
          sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Sessão inválida ou expirada. Faça login novamente.' });
          return true;
        }

        const result = await gameManager.handlePlayerAction(roomId, playerSession, body);
        sendJson(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        console.error('[gameRoutes] Erro ao executar ação:', err);
        sendJson(res, 500, { ok: false, error: 'action_error', message: 'Erro ao processar ação de jogo.' });
        return true;
      }
    }

    return false;
  }

  return {
    handleRequest,
  };
}
