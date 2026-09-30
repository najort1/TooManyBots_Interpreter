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

/** Rotas da UI e APIs protegidas (superfícies públicas ficam abertas; todo o resto exige autenticação). */
export function isProtectedPath(pathname: string): boolean {
  // Rotas públicas explícitas (corretora, casas, carros, jogos, mini-games)
  if (
    pathname === "/bolsa" ||
    pathname.startsWith("/bolsa/") ||
    pathname === "/casas" ||
    pathname.startsWith("/casas/") ||
    pathname === "/carros" ||
    pathname.startsWith("/carros/") ||
    pathname === "/jogos" ||
    pathname.startsWith("/jogos/") ||
    pathname.startsWith("/job/") ||
    pathname === "/api/fun/games" ||
    pathname.startsWith("/api/fun/games/") ||
    pathname === "/api/fun/bolsa" ||
    pathname.startsWith("/api/fun/bolsa/") ||
    pathname === "/api/fun/houses" ||
    pathname.startsWith("/api/fun/houses/") ||
    pathname === "/api/fun/cars" ||
    pathname.startsWith("/api/fun/cars/") ||
    pathname.startsWith("/api/fun/job/")
  ) {
    return false;
  }

  // Abordagem fail-secure: qualquer outra rota do dashboard (/llm, /settings, /selfheal, /desafios, /, /groups, etc.) é protegida
  return true;
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
