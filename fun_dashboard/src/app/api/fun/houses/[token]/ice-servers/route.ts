import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const apiBaseUrl = process.env.FUN_API_URL || "http://127.0.0.1:8790";
const DEFAULT_STUN: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Cache de credenciais TURN no servidor para economizar requisições
let cachedServers: RTCIceServer[] | null = null;
let cacheExpiresAt = 0;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = Date.now();
  if (cachedServers && now < cacheExpiresAt) {
    return Response.json({ iceServers: cachedServers });
  }

  // 1. Tenta buscar do backend Fun (que lê de fun/config.user.json)
  try {
    const upstreamUrl = new URL(`/api/fun/houses/${encodeURIComponent(token)}/ice-servers`, apiBaseUrl);
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-House-Token": token,
      },
      signal: AbortSignal.timeout(3500),
    });

    if (upstream.ok) {
      const data = (await upstream.json()) as { iceServers?: RTCIceServer[] };
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        cachedServers = data.iceServers;
        cacheExpiresAt = now + 20 * 60 * 1000;
        return Response.json({ iceServers: data.iceServers });
      }
    }
  } catch {
    // Ignora e tenta fallback de env ou STUN
  }

  // 2. Fallback direto se configurado em env
  const apiKey = process.env.METERED_API_KEY;
  const appDomain = process.env.METERED_DOMAIN || "chupebot.metered.live";

  if (apiKey) {
    try {
      const url = `https://${appDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
      const upstream = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3500),
      });

      if (upstream.ok) {
        const data = (await upstream.json()) as RTCIceServer[];
        if (Array.isArray(data) && data.length > 0) {
          cachedServers = data;
          cacheExpiresAt = now + 20 * 60 * 1000;
          return Response.json({ iceServers: data });
        }
      }
    } catch {
      // Falha silenciosa
    }
  }

  return Response.json({ iceServers: DEFAULT_STUN });
}

