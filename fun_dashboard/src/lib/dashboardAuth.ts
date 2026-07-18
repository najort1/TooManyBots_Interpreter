/**
 * Auth do dashboard Fun — só server/middleware.
 * A key NUNCA vai em NEXT_PUBLIC_* nem em código de cliente.
 */

/** Só process.env server-side (middleware / Node). */
export function getDashboardApiKey(): string {
  return (
    process.env.FUN_DASHBOARD_API_KEY?.trim() ||
    // fallback mock local se env não setado
    "fun-dashboard-dev-key"
  );
}

export const DASHBOARD_KEY_COOKIE = "fun_dash_key";
export const DASHBOARD_KEY_HEADER = "x-api-key";
export const DASHBOARD_KEY_QUERY = "apiKey";

/** Rotas da UI e APIs protegidas (job play + corretora pública ficam abertos). */
export function isProtectedPath(pathname: string): boolean {
  // Corretora: 100% pública e isolada do admin — sem API key, sem lista de grupos
  if (pathname === "/bolsa" || pathname.startsWith("/bolsa/")) {
    return false;
  }
  if (
    pathname === "/api/fun/bolsa" ||
    pathname.startsWith("/api/fun/bolsa/")
  ) {
    return false;
  }
  // job mini-games
  if (pathname.startsWith("/api/fun/job/")) {
    return false;
  }
  if (pathname.startsWith("/job/")) {
    return false;
  }

  if (pathname === "/overview" || pathname.startsWith("/overview/")) return true;
  if (pathname === "/api/fun/overview") return true;
  if (
    pathname === "/" ||
    pathname.startsWith("/ranking") ||
    pathname.startsWith("/casino") ||
    pathname.startsWith("/groups") ||
    pathname.startsWith("/settings")
  ) {
    return true;
  }
  if (pathname.startsWith("/api/fun/")) {
    return true;
  }
  return false;
}

/**
 * Ordem: cookie httpOnly (browser) → header (server-to-server) → query só no login GET.
 * Query key NÃO fica no cliente como default embutido.
 */
export function extractApiKey(req: {
  headers: Headers;
  nextUrl?: { searchParams: URLSearchParams };
  cookies?: { get: (n: string) => { value: string } | undefined };
}): string {
  const cookie = req.cookies?.get?.(DASHBOARD_KEY_COOKIE)?.value;
  if (cookie?.trim()) return cookie.trim();

  const header =
    req.headers.get(DASHBOARD_KEY_HEADER) ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (header.trim()) return header.trim();

  const q = req.nextUrl?.searchParams?.get(DASHBOARD_KEY_QUERY);
  if (q?.trim()) return q.trim();

  return "";
}

export function isValidApiKey(key: string): boolean {
  const expected = getDashboardApiKey();
  return Boolean(key) && Boolean(expected) && key === expected;
}
