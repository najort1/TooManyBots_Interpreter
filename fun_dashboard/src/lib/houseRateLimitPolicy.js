const REALTIME_METHODS = Object.freeze({
  "realtime/stream": "GET",
  "realtime/move": "POST",
  "realtime/chat": "POST",
  "realtime/signal": "POST",
  "realtime/leave": "POST",
});

/**
 * Classifica apenas as rotas públicas de Casas. O transporte realtime já é
 * autenticado e limitado por sessão no servidor do jogo, portanto não deve
 * consumir o balde HTTP genérico usado pelas ações persistentes/econômicas.
 */
export function getHouseRateLimitPolicy(pathname, method = "GET") {
  const segments = String(pathname || "").split("/").filter(Boolean);
  const isHouseApi = segments[0] === "api" && segments[1] === "fun" && segments[2] === "houses";
  if (!isHouseApi) return null;

  const action = segments.slice(4).join("/");
  const normalizedMethod = String(method || "GET").toUpperCase();
  const realtimeMethod = REALTIME_METHODS[action];

  if (realtimeMethod && realtimeMethod === normalizedMethod) {
    return { bucket: "house-realtime", bypassGeneric: true };
  }

  if (action === "session") {
    return { bucket: "house-session", bypassGeneric: false };
  }

  return { bucket: "houses", bypassGeneric: false };
}
