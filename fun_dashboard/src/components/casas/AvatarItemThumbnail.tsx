"use client";

/* eslint-disable @next/next/no-img-element -- previews locais são data URLs geradas pelo renderer Three.js. */
import { useEffect, useState } from "react";
import type { AvatarCatalogItem } from "@/lib/types";
import { createAvatarPreview } from "./avatar3d";

type Props = {
  item: Pick<AvatarCatalogItem, "id" | "slot" | "name" | "emoji" | "sourceProductId">;
};

const previewCache = new Map<string, string>();
const PREVIEW_RENDER_VERSION = "slot-focus-3";

export function AvatarItemThumbnail({ item }: Props) {
  const cacheKey = `${PREVIEW_RENDER_VERSION}:${item.sourceProductId}:${item.slot}:${item.id}`;
  const [preview, setPreview] = useState(() => previewCache.get(cacheKey) || "");

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      try {
        const next = createAvatarPreview(item, 144);
        if (cancelled) return;
        previewCache.set(cacheKey, next);
        setPreview(next);
      } catch {
        // O ícone semântico continua visível quando WebGL não estiver disponível.
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [cacheKey, item, preview]);

  return <span className="avatar-item-thumbnail" aria-hidden="true">
    {preview
      ? <img src={preview} alt="" draggable={false} />
      : <span className="avatar-item-thumbnail-fallback">{item.emoji}</span>}
  </span>;
}
