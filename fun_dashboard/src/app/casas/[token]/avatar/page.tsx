"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  Coins,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Undo2,
} from "lucide-react";
import { AvatarItemThumbnail } from "@/components/casas/AvatarItemThumbnail";
import { AvatarStudio3D } from "@/components/casas/AvatarStudio3D";
import { funApi } from "@/lib/api";
import type {
  AvatarApplyError,
  AvatarCatalogItem,
  AvatarPurchaseQuote,
  AvatarSlot,
  AvatarSlots,
  AvatarState,
} from "@/lib/types";
import {
  AVATAR_DEFAULT_SLOTS,
  AVATAR_SLOT_FAMILIES,
  getAvatarSlotRemovalValue,
} from "../../../../../../shared/avatar/domain.js";
import { getAvatarSelectionBlockReason, getPendingAvatarPurchaseTotal } from "../../../../../../shared/avatar/studioPurchase.js";

type Props = { params: Promise<{ token: string }> };
type Family = (typeof AVATAR_SLOT_FAMILIES)[number]["id"];
type CameraView = "front" | "side" | "back";

const SLOT_LABELS: Record<AvatarSlot, string> = {
  body: "Estrutura", skinTone: "Tom de pele", face: "Expressão", hair: "Cabelo",
  top: "Parte de cima", bottom: "Parte de baixo", shoes: "Calçados",
  headAccessory: "Cabeça", faceAccessory: "Rosto", neckAccessory: "Pescoço",
  backAccessory: "Costas", waistAccessory: "Cintura",
};

const SLOT_REMOVAL_LABELS: Record<AvatarSlot, string> = {
  body: "estrutura", skinTone: "tom de pele", face: "expressão", hair: "cabelo",
  top: "parte de cima", bottom: "parte de baixo", shoes: "calçados",
  headAccessory: "acessório de cabeça", faceAccessory: "acessório facial",
  neckAccessory: "acessório de pescoço", backAccessory: "acessório das costas", waistAccessory: "acessório da cintura",
};

const FAMILY_COPY: Record<Family, { title: string; description: string }> = {
  body: { title: "Corpo", description: "Estrutura e tom de pele" },
  identity: { title: "Rosto", description: "Expressão e cabelo independentes" },
  clothes: { title: "Roupas", description: "Combine cima, baixo e calçados" },
  accessories: { title: "Acessórios", description: "Use vários pontos do corpo ao mesmo tempo" },
};

const CAMERA_VIEWS: Array<{ id: CameraView; label: string }> = [
  { id: "front", label: "Frente" },
  { id: "side", label: "Lado" },
  { id: "back", label: "Costas" },
];

export default function AvatarPage({ params }: Props) {
  const { token } = use(params);
  const [saved, setSaved] = useState<AvatarState | null>(null);
  const [draft, setDraft] = useState<AvatarSlots | null>(null);
  const [activeFamily, setActiveFamily] = useState<Family>("identity");
  const [activeSlot, setActiveSlot] = useState<AvatarSlot>("face");
  const [cameraView, setCameraView] = useState<CameraView>("front");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<AvatarPurchaseQuote | null>(null);
  const [studioStatus, setStudioStatus] = useState<"loading" | "ready" | "fallback" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const state = await funApi.houses.avatar(token);
      setSaved(state);
      setDraft({ ...state.slots });
      setError("");
    } catch (cause) {
      setError(messageFor(cause));
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const dirty = Boolean(saved && draft && visualKey(saved.slots) !== visualKey(draft));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!quote) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setQuote(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, quote]);

  const family = AVATAR_SLOT_FAMILIES.find((entry) => entry.id === activeFamily) || AVATAR_SLOT_FAMILIES[0];
  const visibleItems = useMemo(
    () => saved?.catalog.filter((item) => item.slot === activeSlot) || [],
    [activeSlot, saved],
  );

  const selectFamily = (id: Family) => {
    const next = AVATAR_SLOT_FAMILIES.find((entry) => entry.id === id);
    if (!next) return;
    setActiveFamily(id);
    setActiveSlot(next.slots[0] as AvatarSlot);
  };

  const selectItem = (item: AvatarCatalogItem) => {
    if (!draft || !saved || getAvatarSelectionBlockReason(item, draft, saved) !== null) return;
    setDraft({ ...draft, [item.slot]: item.id });
    setSuccess("");
    setError("");
  };

  const removeActiveSlot = () => {
    const removalValue = getAvatarSlotRemovalValue(activeSlot);
    if (!draft || !removalValue || draft[activeSlot] === removalValue) return;
    setDraft({ ...draft, [activeSlot]: removalValue });
    setQuote(null);
    setSuccess("");
    setError("");
  };

  const resetDraft = () => setDraft({ ...AVATAR_DEFAULT_SLOTS } as AvatarSlots);
  const cancelDraft = () => {
    if (saved) setDraft({ ...saved.slots });
    setQuote(null);
    setError("");
    setSuccess("");
  };

  const apply = async (confirmedPurchase?: AvatarPurchaseQuote) => {
    if (!saved || !draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await funApi.houses.applyAvatar(token, {
        slots: draft,
        expectedRevision: saved.revision,
        catalogRevision: saved.catalogRevision,
        idempotencyKey: crypto.randomUUID(),
        confirmedPurchase,
      });
      setSaved({ ...saved, ...result.state, coins: result.coins });
      setDraft({ ...result.state.slots });
      setQuote(null);
      setSuccess(result.purchased.length ? "Visual aplicado e itens liberados." : "Visual aplicado.");
    } catch (cause) {
      const next = cause as AvatarApplyError;
      if (next.code === "purchase-confirmation-required" && next.quote) setQuote(next.quote);
      else if (next.code === "appearance-revision-conflict" && next.current) {
        setSaved(next.current);
        setDraft({ ...next.current.slots });
        setError("O avatar mudou em outra aba. Recarregamos a versão mais recente.");
      } else setError(messageFor(next));
    } finally {
      setBusy(false);
    }
  };

  if (!saved || !draft) {
    return <main className="avatar-loading" role={error ? "alert" : undefined}>
      <Sparkles aria-hidden="true" />
      <strong>{error || "Preparando o estúdio modular…"}</strong>
      {!error && <span>Montando corpo, roupas e acessórios.</span>}
    </main>;
  }

  const preview = { slots: draft };
  const currentProductNames = quote?.itemIds.map((id) => saved.catalog.find((item) => item.sourceProductId === id)?.name).filter(Boolean) || [];
  const removalValue = getAvatarSlotRemovalValue(activeSlot);
  const canRemoveActiveSlot = removalValue !== null;
  const activeSlotIsEmpty = canRemoveActiveSlot && draft[activeSlot] === removalValue;

  return <main className="avatar-page avatar-editor-v2">
    <header className="avatar-topbar">
      <Link href={`/casas/${token}`} className="avatar-back" onClick={(event) => {
        if (dirty && !window.confirm("Descartar as alterações do avatar?")) event.preventDefault();
      }}><ChevronLeft size={16} aria-hidden="true" /> Voltar para casa</Link>
      <div className="avatar-account-status">
        <span className="casas-coin-pill"><Sparkles size={13} aria-hidden="true" /> Nível {saved.level}</span>
        <span className="casas-coin-pill"><Coins size={13} aria-hidden="true" /> {saved.coins} coins</span>
      </div>
    </header>

    <div className="avatar-feedback" aria-live="polite">
      {error && <p className="casas-toast casas-toast-error"><ShieldAlert size={16} aria-hidden="true" />{error}</p>}
      {success && <p className="casas-toast avatar-toast-success"><Check size={16} aria-hidden="true" />{success}</p>}
    </div>

    <div className="avatar-layout avatar-layout-v2">
      <section className="avatar-stage avatar-stage-v2" aria-labelledby="avatar-editor-title">
        <div className="avatar-stage-copy">
          <p className="casas-kicker">ESTÚDIO MODULAR · V2</p>
          <h1 id="avatar-editor-title">Monte seu personagem.</h1>
          <p>Corpo, rosto, cabelo, roupas e acessórios agora são peças independentes no mesmo rig usado na casa e no bairro.</p>
        </div>
        <div className="avatar-view-toolbar" aria-label="Ângulo da prévia">
          {CAMERA_VIEWS.map((view) => <button key={view.id} type="button" aria-pressed={cameraView === view.id} onClick={() => setCameraView(view.id)} className={cameraView === view.id ? "is-active" : ""}>{view.label}</button>)}
          <button type="button" onClick={() => setCameraView("front")} aria-label="Repor câmera"><RotateCcw size={15} aria-hidden="true" /></button>
        </div>
        <div className="avatar-studio-shell" data-studio-status={studioStatus}>
          <AvatarStudio3D avatar={preview} view={cameraView} onStatusChange={setStudioStatus} />
          <div className="avatar-studio-hint">Arraste para girar · roda para aproximar</div>
          {studioStatus === "loading" && <div className="avatar-studio-loading">Montando peças…</div>}
        </div>
        <div className="avatar-stage-actions">
          <button type="button" className="avatar-action-secondary" disabled={!dirty || busy} onClick={cancelDraft}><Undo2 size={16} aria-hidden="true" />Cancelar</button>
          <button type="button" className="avatar-action-secondary" disabled={busy} onClick={resetDraft}><RotateCcw size={16} aria-hidden="true" />Padrão</button>
          <button type="button" className="avatar-action-primary" disabled={!dirty || busy} onClick={() => void apply()}><Save size={16} aria-hidden="true" />{busy ? "Aplicando…" : "Aplicar visual"}</button>
        </div>
      </section>

      <section className="avatar-wardrobe avatar-wardrobe-v2" aria-labelledby="avatar-catalog-title">
        <div className="avatar-wardrobe-heading">
          <div><p className="casas-kicker">CATÁLOGO</p><h2 id="avatar-catalog-title">{FAMILY_COPY[activeFamily].title}</h2><p>{FAMILY_COPY[activeFamily].description}</p></div>
          <span className="avatar-count">{visibleItems.filter((item) => item.owned).length}/{visibleItems.length}</span>
        </div>

        <div className="avatar-tabs" role="tablist" aria-label="Famílias do avatar">
          {AVATAR_SLOT_FAMILIES.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={entry.id === activeFamily} onClick={() => selectFamily(entry.id as Family)} className={`avatar-tab ${entry.id === activeFamily ? "avatar-tab-active" : ""}`}><span>{entry.name}</span></button>)}
        </div>

        <div className="avatar-subtabs" role="tablist" aria-label={`Categorias de ${family.name}`}>
          {family.slots.map((slot) => <button key={slot} type="button" role="tab" aria-selected={slot === activeSlot} onClick={() => setActiveSlot(slot as AvatarSlot)} className={slot === activeSlot ? "is-active" : ""}>{SLOT_LABELS[slot as AvatarSlot]}</button>)}
        </div>

        <div className="avatar-item-grid" role="list" aria-label={SLOT_LABELS[activeSlot]}>
          {canRemoveActiveSlot && <button
            type="button"
            aria-pressed={activeSlotIsEmpty}
            disabled={activeSlotIsEmpty}
            onClick={removeActiveSlot}
            className={`avatar-item-card avatar-item-remove ${activeSlotIsEmpty ? "is-selected" : ""}`}
          >
            <span className="avatar-item-thumbnail avatar-item-remove-icon" aria-hidden="true">×</span>
            <span className="avatar-item-card-copy"><b>{activeSlotIsEmpty ? "Sem peça equipada" : "Remover peça"}</b><small>{activeSlotIsEmpty ? `Sem ${SLOT_REMOVAL_LABELS[activeSlot]}` : `Remover ${SLOT_REMOVAL_LABELS[activeSlot]} do visual`}</small></span>
            {activeSlotIsEmpty && <Check size={16} aria-label="Selecionado" />}
          </button>}
          {visibleItems.map((item) => {
            const selected = draft[item.slot] === item.id;
            const blockedReason = getAvatarSelectionBlockReason(item, draft, saved);
            const blocked = blockedReason !== null;
            return <button key={item.id} type="button" aria-pressed={selected} disabled={blocked} onClick={() => selectItem(item)} className={`avatar-item-card ${selected ? "is-selected" : ""} ${blocked ? "is-locked" : ""}`}>
              <AvatarItemThumbnail item={item} />
              <span className="avatar-item-card-copy"><b>{item.name}</b><small>{itemStateLabel(item, selected, blockedReason, draft, saved)}</small></span>
              {selected && <Check size={16} aria-label="Selecionado" />}
            </button>;
          })}
        </div>
      </section>
    </div>

    {quote && <div className="avatar-dialog-backdrop" role="presentation" onMouseDown={() => setQuote(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="avatar-purchase-title" className="avatar-purchase-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <Coins size={24} aria-hidden="true" />
        <h2 id="avatar-purchase-title">Liberar itens?</h2>
        <p>{currentProductNames.length ? currentProductNames.join(", ") : `${quote.itemIds.length} itens`} serão seus depois da confirmação.</p>
        <strong>{quote.total} coins</strong>
        <div><button type="button" className="avatar-action-secondary" onClick={() => setQuote(null)}>Agora não</button><button type="button" className="avatar-action-primary" onClick={() => void apply(quote)} disabled={busy}>{busy ? "Confirmando…" : "Confirmar e aplicar"}</button></div>
      </section>
    </div>}
  </main>;
}

function visualKey(slots: AvatarSlots) {
  return Object.values(slots).join("|");
}

function itemStateLabel(
  item: AvatarCatalogItem,
  selected: boolean,
  blockedReason: ReturnType<typeof getAvatarSelectionBlockReason>,
  draft: AvatarSlots,
  saved: AvatarState,
) {
  if (selected) return "No visual atual";
  if (blockedReason === "level") return `Nível ${item.unlockLevel}`;
  if (blockedReason === "coins") return `Faltam ${Math.max(0, getPendingAvatarPurchaseTotal({ ...draft, [item.slot]: item.id }, saved.catalog) - saved.coins)} coins`;
  if (item.owned) return "Disponível";
  return `${item.cost} coins`;
}

function messageFor(cause: unknown) {
  const error = cause as AvatarApplyError;
  const messages: Record<string, string> = {
    "insufficient-coins": `Coins insuficientes. Faltam ${Math.max(0, Number(error.need) - Number(error.coins))}.`,
    "level-locked": "Uma das peças ainda está bloqueada pelo seu nível.",
    "catalog-revision-conflict": "O catálogo mudou. Recarregue o estúdio.",
    "invalid-appearance": "Essa combinação não é válida.",
    "avatar-disabled": "Avatares estão temporariamente desligados.",
  };
  return messages[error.code || ""] || (error instanceof Error ? error.message : "Não foi possível atualizar o visual.");
}
