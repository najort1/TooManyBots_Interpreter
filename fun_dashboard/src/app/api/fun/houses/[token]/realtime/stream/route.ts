import { NextRequest } from "next/server";

const apiBaseUrl = process.env.FUN_API_URL || "http://127.0.0.1:8790";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ token: string }> };

/**
 * O rewrite genérico do Next segura a resposta SSE quando o dashboard é
 * exposto pelo túnel. Este handler conserva o ReadableStream do backend até
 * o EventSource do navegador, sem tocar no ticket ou na sala do jogador.
 */
export async function GET(request: NextRequest, { params }: Context) {
  const { token } = await params;
  const upstreamUrl = new URL(`/api/fun/houses/${encodeURIComponent(token)}/realtime/stream`, apiBaseUrl);
  upstreamUrl.search = request.nextUrl.search;

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      signal: request.signal,
    });

    if (!upstream.ok) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8" },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "realtime-indisponivel" }, { status: 503 });
  }
}
