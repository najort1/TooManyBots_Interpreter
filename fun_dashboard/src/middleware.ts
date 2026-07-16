import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DASHBOARD_KEY_COOKIE,
  DASHBOARD_KEY_HEADER,
  DASHBOARD_KEY_QUERY,
  extractApiKey,
  isProtectedPath,
  isValidApiKey,
} from "@/lib/dashboardAuth";
import { rateLimit } from "@/lib/rateLimit";

const RATE_MAX = Number(process.env.FUN_DASHBOARD_RATE_MAX || 60);
const RATE_WINDOW_MS = Number(process.env.FUN_DASHBOARD_RATE_WINDOW_MS || 60_000);

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

function unauthorized(isApi: boolean, reason: string) {
  if (isApi) {
    return NextResponse.json(
      {
        error: "unauthorized",
        reason,
        // não vaza a key; só como autenticar
        hint: `Cookie ${DASHBOARD_KEY_COOKIE} (login no browser) ou header ${DASHBOARD_KEY_HEADER}`,
      },
      { status: 401 }
    );
  }
  // Form de login: key NÃO aparece no HTML (só o user digita)
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Fun · Auth</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#fafafa;color:#18181b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:1.5rem;max-width:22rem;width:90%}
    h1{font-size:1.1rem;margin:0 0 .5rem}
    p{font-size:.85rem;color:#71717a;margin:0 0 1rem;line-height:1.4}
    input{width:100%;box-sizing:border-box;padding:.65rem .75rem;border:1px solid #e4e4e7;border-radius:8px;font-size:.95rem}
    button{margin-top:.75rem;width:100%;padding:.7rem;border:0;border-radius:8px;background:#18181b;color:#fff;font-weight:500;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <h1>Dashboard protegido</h1>
    <p>Informe a API key configurada no servidor (<code style="font-size:.75rem">FUN_DASHBOARD_API_KEY</code>). Ela não fica no frontend.</p>
    <form method="GET">
      <input name="${DASHBOARD_KEY_QUERY}" type="password" placeholder="API key" autocomplete="current-password" required />
      <button type="submit">Entrar</button>
    </form>
    <p style="margin-top:1rem;margin-bottom:0;font-size:.75rem">Rate limit: ${RATE_MAX} req / ${Math.round(RATE_WINDOW_MS / 1000)}s por IP</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const ip = clientIp(req);
  const rl = rateLimit(`dash:${ip}:${pathname.split("/")[1] || "root"}`, {
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX,
  });

  if (!rl.ok) {
    const isApi = pathname.startsWith("/api/");
    const headers = {
      "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
      "X-RateLimit-Limit": String(rl.limit),
      "X-RateLimit-Remaining": "0",
    };
    if (isApi) {
      return NextResponse.json(
        { error: "rate-limit", retryAfterSec: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        { status: 429, headers }
      );
    }
    return new NextResponse("Too Many Requests — aguarde e tente de novo.", {
      status: 429,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const key = extractApiKey(req);
  const isApi = pathname.startsWith("/api/");

  if (!isValidApiKey(key)) {
    return unauthorized(isApi, "missing-or-invalid-api-key");
  }

  // key ok via query → grava cookie e redireciona limpo
  const qKey = req.nextUrl.searchParams.get(DASHBOARD_KEY_QUERY);
  if (qKey && isValidApiKey(qKey.trim()) && !isApi) {
    const clean = req.nextUrl.clone();
    clean.searchParams.delete(DASHBOARD_KEY_QUERY);
    const res = NextResponse.redirect(clean);
    res.cookies.set(DASHBOARD_KEY_COOKIE, qKey.trim(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12, // 12h
    });
    res.headers.set("X-RateLimit-Limit", String(rl.limit));
    res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    return res;
  }

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(rl.limit));
  res.headers.set("X-RateLimit-Remaining", String(rl.remaining));

  // se autenticou por header/query sem cookie, reforça cookie
  if (key && !req.cookies.get(DASHBOARD_KEY_COOKIE)) {
    res.cookies.set(DASHBOARD_KEY_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }

  return res;
}

export const config = {
  matcher: [
    "/",
    "/overview/:path*",
    "/ranking/:path*",
    "/casino/:path*",
    "/groups/:path*",
    "/settings/:path*",
    "/api/fun/:path*",
  ],
};
