import { readFileSync } from 'node:fs';
import { formatHelp, resolveHelpTarget } from '../formatters/helpGuide.js';
import { getReactionKind, normalizeReactionAction } from './reactionMediaService.js';
import { resolveStickerPath, STICKER_SLUGS } from './personaStickerCatalog.js';
import { imageBufferToSticker } from '../utils/stickerConvert.js';
import { formatDatedFact } from '../utils/factTemporalContext.js';

const VIRTUAL_RUSSIAN_ACTOR = '__persona_virtual_russian__';

function clean(value, max = 240) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function hasContextualInvite(text, kind) {
  const source = String(text || '').toLowerCase();
  const patterns = {
    start_russian: /roleta|russa|gatilho|coragem|duelo|resolver|desafio|jogar/iu,
    oracle: /or[aá]culo|previs[aã]o|destino|vou .*namorar|pergunta/iu,
    illuminati: /illuminati|conspira|teoria/iu,
    gossip: /fofoca|boato|rumor|fofoca/iu,
    tarot: /tar[oô]|cartas|arcano|tiragem|leitura/iu,
    ship: /ship|casal|combin|qu[ií]mica|namor|romance/iu,
    cancel: /cancel|cancelamento/iu,
    reaction: /abra[cç]|hug|beij|kiss|tapa|slap|rea[cç][aã]o|high.?five|acena|wave|rir|laugh|chora|cry/iu,
  };
  return patterns[kind]?.test(source) !== false;
}

function resolveTarget(ctx, raw) {
  const kind = String(raw || 'author').toLowerCase();
  if (kind === 'author') return ctx.authorJid || '';
  if (kind === 'quoted') return ctx.quotedParticipant || '';
  if (kind === 'mentioned') return Array.isArray(ctx.mentionedJids) ? ctx.mentionedJids[0] || '' : '';
  return '';
}

function labelOf(ctx, jid) {
  return clean(ctx.getContactDisplayName?.(jid) || String(jid || '').split('@')[0] || 'alguém', 60);
}

function resolveShipTargets(ctx, raw) {
  const mode = String(raw || 'auto').toLowerCase();
  const mentioned = Array.isArray(ctx.mentionedJids) ? ctx.mentionedJids.filter(Boolean) : [];
  const quoted = String(ctx.quotedParticipant || '').trim();
  const author = String(ctx.authorJid || '').trim();
  if (mode === 'mentioned_pair' && mentioned.length >= 2) return [mentioned[0], mentioned[1]];
  if (mode === 'author_and_mentioned' && author && mentioned[0]) return [author, mentioned[0]];
  if (mode === 'author_and_quoted' && author && quoted) return [author, quoted];
  if (mode !== 'auto') return [];
  if (mentioned.length >= 2) return [mentioned[0], mentioned[1]];
  if (author && mentioned[0]) return [author, mentioned[0]];
  if (author && quoted) return [author, quoted];
  return [];
}

function shipBar(percent) {
  const filled = Math.max(0, Math.min(10, Math.round((Number(percent) || 0) / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

export function createPersonaToolExecutor({
  chaosService,
  newsService = null,
  groupMemoryService = null,
  memoryRepository = null,
  tarotService = null,
  relationshipService = null,
  reactionMediaService = null,
  getContactDisplayName = null,
} = {}) {
  if (!chaosService) throw new Error('[fun/personaToolExecutor] chaosService required');

  const cooldowns = new Map();

  function inCooldown(scopeKey, now, funConfig) {
    const cooldownMs = Math.max(5_000, Number(funConfig?.personaToolCooldownMs) || 45_000);
    const until = cooldowns.get(scopeKey) || 0;
    if (until > now) return Math.ceil((until - now) / 1000);
    cooldowns.set(scopeKey, now + cooldownMs);
    return 0;
  }

  async function execute(call, ctx = {}) {
    const name = String(call?.name || '');
    const args = call?.arguments || {};
    const scopeKey = String(ctx.scopeKey || '');
    const now = Number(ctx.now) || Date.now();
    const base = { tool: name, ok: false, text: '' };
    if (!scopeKey.endsWith('@g.us')) return { ...base, reason: 'group-only', text: 'Isso só rola no grupo.' };

    if (name === 'help') {
      const topic = clean(args.topic, 60);
      const resolved = resolveHelpTarget(topic);
      return {
        ...base,
        ok: true,
        text: formatHelp(ctx.funConfig?.prefix || '/', resolved || topic, false),
        topic: resolved,
      };
    }

    if (name === 'group_status') {
      const hour = Number(ctx.funConfig?.groupNewsHour ?? 23);
      const minute = String(Number(ctx.funConfig?.groupNewsMinute ?? 59)).padStart(2, '0');
      const running = chaosService.getRussian?.(scopeKey, ctx.funConfig, now);
      const journalEnabled = newsService?.enabled?.(ctx.funConfig) !== false;
      return {
        ...base,
        ok: true,
        text: [
          `📰 Jornal automático: ${journalEnabled ? `*${hour}:${minute}*` : 'desligado'}.`,
          running ? `☠️ Roleta aberta: *${running.remaining}/${running.chambers}* câmaras.` : '☠️ Nenhuma roleta aberta agora.',
        ].join('\n'),
      };
    }

    if (name === 'lore') {
      const query = clean(args.query || ctx.text, 120).toLowerCase();
      const tokens = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\W+/).filter((x) => x.length >= 3);
      const facts = memoryRepository?.listFacts?.(scopeKey, { limit: 50, minScore: 0 }) || [];
      const matches = facts.filter((fact) => !tokens.length || tokens.some((token) => String(fact.summary || '').toLowerCase().includes(token))).slice(0, 5);
      return {
        ...base,
        ok: true,
        text: matches.length
          ? [
              '🧠 *Lore lembrada*',
              ...matches.map((fact) =>
                `• ${formatDatedFact(fact, clean(fact.summary, 180), ctx.funConfig?.worldTimezone)}`
              ),
            ].join('\n')
          : 'Não achei um fato de lore confiável sobre isso por aqui.',
      };
    }

    if (!hasContextualInvite(ctx.text, name)) {
      return { ...base, reason: 'not-contextual', text: 'Não vou forçar essa brincadeira do nada.' };
    }
    const remaining = inCooldown(scopeKey, now, ctx.funConfig);
    if (remaining) return { ...base, reason: 'cooldown', text: `Vou segurar a onda por mais ${remaining}s.` };

    const chaosKind = { oracle: 'oracle', illuminati: 'illuminati', gossip: 'gossip', cancel: 'cancel' }[name];
    if (chaosKind) {
      const cooldown = chaosService.checkCooldown?.(
        chaosKind,
        ctx.authorJid,
        scopeKey,
        ctx.funConfig,
        now
      );
      if (cooldown && !cooldown.ok) {
        return { ...base, reason: 'command-cooldown', text: `Esse caos ainda está em cooldown (${cooldown.retryIn || 'aguarde'}).` };
      }
    }

    if (name === 'start_russian') {
      const started = chaosService.startRussian({ userJid: ctx.authorJid, scopeKey, funConfig: ctx.funConfig, now });
      if (!started.ok) return { ...base, reason: started.reason, text: `☠️ A roleta já está na mesa: *${started.remaining}/${started.chambers}* câmaras.` };
      const virtual = chaosService.pullTrigger({
        userJid: VIRTUAL_RUSSIAN_ACTOR,
        scopeKey,
        funConfig: ctx.funConfig,
        now: now + 1_501,
        virtual: true,
      });
      const botTurn = virtual.died
        ? 'Eu puxei primeiro e fui de base virtualmente. A mesa fechou sem punir ninguém.'
        : `Eu puxei primeiro: *click*. Restam *${virtual.remaining}/${virtual.chambers}* câmaras.`;
      return {
        ...base,
        ok: true,
        text: ['☠️ *Roleta russa*', botTurn, virtual.died ? '' : 'Agora é com vocês: `/puxar`.', '_Não é real. É só o grupo sendo o grupo._'].filter(Boolean).join('\n'),
        virtual,
      };
    }

    if (name === 'oracle') {
      const question = clean(args.question || ctx.text, 180);
      if (!question) return { ...base, reason: 'missing-question', text: 'Me dá uma pergunta pro oráculo.' };
      return { ...base, ok: true, text: ['🔮 *Oráculo maluco*', chaosService.oracleInsane(question)].join('\n') };
    }

    if (name === 'tarot') {
      if (!tarotService?.reading) return { ...base, reason: 'unavailable', text: 'Meu baralho está guardado agora.' };
      const question = clean(args.question || '', 500);
      const result = await tarotService.reading({
        userJid: ctx.authorJid,
        scopeKey,
        question,
        funConfig: ctx.funConfig,
        now,
      });
      if (!result?.ok) {
        const text = result?.reason === 'cooldown'
          ? `O baralho precisa respirar mais ${result.retryIn || 'um pouco'}.`
          : 'Não consegui abrir o baralho agora.';
        return { ...base, reason: result?.reason || 'failed', text };
      }
      return {
        ...base,
        ok: true,
        text: ['🔮 *Tiragem*', `Pergunta: _${clean(result.question, 180)}_`, result.drawText, '✨ *Leitura*', clean(result.reading, 3_000)].filter(Boolean).join('\n'),
      };
    }

    if (name === 'ship') {
      if (!relationshipService?.ship) return { ...base, reason: 'unavailable', text: 'Meu medidor de química está fora do ar.' };
      const [userA, userB] = resolveShipTargets(ctx, args.mode);
      if (!userA || !userB || userA === userB) {
        return { ...base, reason: 'missing-targets', text: 'Preciso de duas pessoas diferentes: duas menções, uma menção sua ou um reply.' };
      }
      const result = relationshipService.ship(userA, userB);
      if (!result?.ok) return { ...base, reason: result?.reason || 'failed', text: 'Esse ship não saiu do papel.' };
      const labels = [labelOf({ ...ctx, getContactDisplayName: ctx.getContactDisplayName || getContactDisplayName }, userA), labelOf({ ...ctx, getContactDisplayName: ctx.getContactDisplayName || getContactDisplayName }, userB)];
      return {
        ...base,
        ok: true,
        text: ['💘 *Ship*', `${labels[0]} × ${labels[1]}`, `${shipBar(result.percent)} *${result.percent}%*`, `_${result.label}_`].join('\n'),
      };
    }

    if (name === 'cancel') {
      const target = resolveTarget(ctx, args.target);
      if (!target) return { ...base, reason: 'missing-target', text: 'Preciso de uma menção, reply ou de você como alvo.' };
      const label = labelOf({ ...ctx, getContactDisplayName: ctx.getContactDisplayName || getContactDisplayName }, target);
      return {
        ...base,
        ok: true,
        text: ['🚫 *Cancelamento*', chaosService.cancelAbsurd(label), '_Motivo 100% absurdo. Não é sério._'].join('\n'),
        target: label,
      };
    }

    if (name === 'reaction') {
      const action = normalizeReactionAction(args.action);
      if (!action || getReactionKind(action) === 'nsfw') {
        return { ...base, reason: 'unsafe-action', text: 'Só mando reações SFW por aqui.' };
      }
      if (!reactionMediaService?.getReaction || typeof ctx.replyImageUrl !== 'function') {
        return { ...base, reason: 'unavailable', text: 'Não consigo mandar mídia agora.' };
      }
      const target = resolveTarget(ctx, args.target);
      if (!target) return { ...base, reason: 'missing-target', text: 'Preciso de uma menção, reply ou de você como alvo.' };
      const label = labelOf({ ...ctx, getContactDisplayName: ctx.getContactDisplayName || getContactDisplayName }, target);
      const media = await reactionMediaService.getReaction(action, { funConfig: ctx.funConfig });
      if (!media?.ok || !media.url) return { ...base, reason: media?.reason || 'no-media', text: 'Não consegui achar uma reação boa agora.' };
      await ctx.replyImageUrl(media.url, `*Eu* mandei ${action} para *${label}*.`, media.mimeType);
      return { ...base, ok: true, text: '', summary: `Reação SFW ${action} enviada para ${label}.`, action, target: label };
    }

    if (name === 'illuminati' || name === 'gossip') {
      const target = resolveTarget(ctx, args.target);
      if (!target) return { ...base, reason: 'missing-target', text: 'Preciso de uma menção, reply ou de você como alvo.' };
      const label = labelOf({ ...ctx, getContactDisplayName: ctx.getContactDisplayName || getContactDisplayName }, target);
      const text = name === 'illuminati'
        ? ['👁️ *Illuminati*', chaosService.illuminatiTheory(label), '_Teoria aleatória. Nenhuma prova._'].join('\n')
        : ['👂 *Fofoca*', chaosService.gossipFake(label), '_Falsa. Inventada. Sem provas._'].join('\n');
      return { ...base, ok: true, text, target: label };
    }

    if (name === 'send_sticker') {
      const slug = String(args.slug || '').trim();
      if (!slug || !STICKER_SLUGS.includes(slug)) {
        return { ...base, reason: 'invalid-slug', text: `Slug inválido. Opções: ${STICKER_SLUGS.slice(0, 8).join(', ')}…` };
      }
      if (typeof ctx.replySticker !== 'function') {
        return { ...base, reason: 'unavailable', text: 'Não consigo mandar figurinha agora.' };
      }
      const filePath = resolveStickerPath(slug);
      if (!filePath) {
        return { ...base, reason: 'file-not-found', text: 'Figurinha não encontrada no disco.' };
      }
      let stickerBuffer;
      try {
        const raw = readFileSync(filePath);
        stickerBuffer = await imageBufferToSticker(raw);
      } catch (err) {
        return { ...base, reason: 'convert-failed', text: 'Não consegui converter a figurinha.' };
      }
      await ctx.replySticker(stickerBuffer);
      return { ...base, ok: true, text: '', summary: `Figurinha "${slug}" enviada.`, slug };
    }

    return { ...base, reason: 'unknown-tool', text: '' };
  }

  return { execute, VIRTUAL_RUSSIAN_ACTOR, _cooldowns: cooldowns };
}
