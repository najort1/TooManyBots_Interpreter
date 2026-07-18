/**
 * Perfil social por grupo: nick, bio, aniversário, título.
 * Entrada principal: texto livre → LLM (Zen→Ollama) + fallback regex.
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { ollamaGenerate } from '../llm/ollamaClient.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { recordLlmHit } from '../llm/llmMetrics.js';

const EXTRACT_SYSTEM = `Você extrai dados de perfil social de um texto livre em pt-BR (grupo WhatsApp).

Responda SOMENTE JSON válido (sem markdown):
{"nickname":string|null,"bio":string|null,"birthday":string|null,"title":string|null,"extras":string|null}

Regras:
- nickname: apelido curto (2–24 chars), como as pessoas chamam a pessoa no grupo. null se não houver.
- bio: "conhecido por" / o que a pessoa é no grupo (1 frase ≤160). null se não houver.
- birthday: data dia/mês (ex "15/03", "12 de agosto"). SEM ano. null se não houver.
- title: flair/título cosmético (ex "Lenda"). null se não houver.
- extras: resto inútil/fofoca que NÃO entrou em nick/bio/niver/title (ex. "proano que nunca pisou no Fábio", "sou negro", time, gosto aleatório). 1–2 frases curtas ≤280. null se não sobrar nada.
- NÃO repita em extras o que já foi em nickname/bio/birthday/title.
- NÃO invente. Se o texto não traz o campo, use null (não invente).
- NÃO salve telefone, PIX, senha, endereço.
Só o JSON.`;

const MONTHS_PT = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  março: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
};

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function looksSensitive(text) {
  const t = String(text || '');
  if (/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b/.test(t)) return true;
  if (/\b\d{10,13}\b/.test(t) && /(zap|whats|telefone|celular|pix)/i.test(t)) return true;
  if (/(senha|password|token|api[_-]?key)\s*[:=]/i.test(t)) return true;
  return false;
}

function containsBlocklist(text, list = []) {
  const n = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const raw of list || []) {
    const b = String(raw || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    if (b && n.includes(b)) return true;
  }
  return false;
}

/** DD/MM ou MM-DD store → MM-DD */
export function parseBirthdayInput(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!s) return { ok: false, reason: 'empty' };

  // 15/03 · 15-03 · 15.03
  let m = s.match(/\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*\d{2,4})?\b/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    return validateDayMonth(day, month);
  }

  // 03/15 estilo US se day>12 e month<=12 invertido? skip — BR first
  // 15 de março
  m = s.match(/\b(\d{1,2})\s*(?:de\s+)?([a-zç]+)\b/);
  if (m) {
    const day = Number(m[1]);
    const monName = m[2];
    const month = MONTHS_PT[monName];
    if (month) return validateDayMonth(day, month);
  }

  // já MM-DD
  m = s.match(/^(\d{2})-(\d{2})$/);
  if (m) return validateDayMonth(Number(m[2]), Number(m[1]));

  return { ok: false, reason: 'unparsed' };
}

function validateDayMonth(day, month) {
  const d = Math.floor(Number(day));
  const mo = Math.floor(Number(month));
  if (!Number.isFinite(d) || !Number.isFinite(mo)) return { ok: false, reason: 'invalid' };
  if (mo < 1 || mo > 12) return { ok: false, reason: 'month' };
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d < 1 || d > maxDay) return { ok: false, reason: 'day' };
  // 29/02 ok store; runtime leap year not enforced for display
  const md = `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { ok: true, birthdayMd: md, day: d, month: mo };
}

export function formatBirthdayDisplay(birthdayMd) {
  const s = String(birthdayMd || '').trim();
  const m = s.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[2]}/${m[1]}`;
}

export function sanitizeNickname(raw, { max = 24, blocklist = [] } = {}) {
  let n = String(raw || '')
    .trim()
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ');
  n = n.replace(/^@+/, '').trim();
  if (!n) return { ok: false, reason: 'empty' };
  if (n.length < 2) return { ok: false, reason: 'short' };
  if (n.length > max) n = n.slice(0, max);
  if (/^https?:\/\//i.test(n) || /\s/.test(n) === false && n.includes('.')) {
    // allow spaces in nick but block pure urls
  }
  if (/https?:\/\//i.test(n) || /www\./i.test(n)) return { ok: false, reason: 'url' };
  if (/^\d{6,}$/.test(n.replace(/\s/g, ''))) return { ok: false, reason: 'digits' };
  if (/^\/\w+/.test(n)) return { ok: false, reason: 'command' };
  if (looksSensitive(n)) return { ok: false, reason: 'sensitive' };
  if (containsBlocklist(n, blocklist)) return { ok: false, reason: 'blocklist' };
  return { ok: true, value: n };
}

export function sanitizeBio(raw, { max = 160, blocklist = [] } = {}) {
  let b = String(raw || '')
    .trim()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!b) return { ok: false, reason: 'empty' };
  if (b.length < 4) return { ok: false, reason: 'short' };
  if (b.length > max) b = b.slice(0, max);
  if (looksSensitive(b)) return { ok: false, reason: 'sensitive' };
  if (containsBlocklist(b, blocklist)) return { ok: false, reason: 'blocklist' };
  return { ok: true, value: b };
}

export function sanitizeTitle(raw, { max = 16, blocklist = [] } = {}) {
  let t = String(raw || '')
    .trim()
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > max) t = t.slice(0, max);
  if (looksSensitive(t) || containsBlocklist(t, blocklist)) {
    return { ok: false, reason: 'blocked' };
  }
  return { ok: true, value: t };
}

export function sanitizeExtras(raw, { max = 280, blocklist = [] } = {}) {
  let t = String(raw || '')
    .trim()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!t) return { ok: false, reason: 'empty' };
  // evita "ok blz" / ruído sem fofoca real
  if (t.length < 8) return { ok: false, reason: 'short' };
  if (/^(ok|blz|beleza|sim|n[aã]o|valeu|tmj|flw|obrigado|obrigada)[\s.!?]*$/i.test(t)) {
    return { ok: false, reason: 'filler' };
  }
  if (t.length > max) t = t.slice(0, max);
  if (looksSensitive(t)) return { ok: false, reason: 'sensitive' };
  if (containsBlocklist(t, blocklist)) return { ok: false, reason: 'blocklist' };
  return { ok: true, value: t };
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resto do texto livre depois de tirar nick/bio/niver/title.
 * Ex.: "sou um proano… e sou negro"
 */
export function deriveExtras(raw, fields = {}, { max = 280 } = {}) {
  let t = String(raw || '').trim();
  if (!t) return '';

  // rótulos + valores estruturados
  t = t.replace(
    /\b(apelido|nick|nickname|bio|niver|aniversario|aniversário|titulo|título|title|extras?|conhecido\s+por|conhecida\s+por)\s*[:\-]\s*/gi,
    ' '
  );
  t = t.replace(
    /(?:me\s+chamam\s+de|me\s+chamo|me\s+conhecem\s+como)\s+["']?[A-Za-zÀ-ÿ0-9][\wÀ-ÿ .'-]{0,30}/gi,
    ' '
  );
  t = t.replace(
    /(?:conhecido\s+por|conhecida\s+por|sou\s+conhecido\s+por|sou\s+conhecida\s+por)\s+.+?(?=\s*[,.]|\s+(?:niver|anivers|fa[cç]o|e\s+sou|titulo|título)\b|$)/gi,
    ' '
  );
  t = t.replace(
    /(?:fa[cç]o\s+)?(?:niver|anivers[aá]rio|birthday|nasci\s+em)\s*[:\-]?\s*(?:\d{1,2}\s*[\/\-.]\s*\d{1,2}(?:\s*[\/\-.]\s*\d{2,4})?|\d{1,2}\s*(?:de\s+)?[a-zà-úç]{3,12})/gi,
    ' '
  );
  t = t.replace(/\b\d{1,2}\s*[\/\-.]\s*\d{1,2}(?:\s*[\/\-.]\s*\d{2,4})?\b/g, ' ');
  t = t.replace(
    /(?:t[ií]tulo|title|flair)\s*[:\-]?\s*["']?[A-Za-zÀ-ÿ0-9][\wÀ-ÿ .'-]{0,28}/gi,
    ' '
  );

  for (const key of ['nickname', 'bio', 'title', 'birthday']) {
    const v = String(fields[key] || '').trim();
    if (v.length >= 2) {
      t = t.replace(new RegExp(escapeRegExp(v), 'ig'), ' ');
    }
  }

  t = t
    .replace(/\s*[,;|/]+\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\b(e\s+){2,}/gi, 'e ')
    .replace(/\s+e\s+e\s+/gi, ' e ')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .replace(/^(e\s+)/i, '')
    .trim();

  // limpa "sou o/a" órfão e partículas soltas
  t = t.replace(/\b(sou o|sou a)\s*$/i, '').trim();
  if (t.length < 8) return '';
  // se sobrou só eco de campo estruturado / filler, ignora
  if (/^(ok|blz|beleza|sim|n[aã]o|valeu|tmj|flw)[\s.!?]*$/i.test(t)) return '';
  if (/^(dudu|nina|zé|ze)$/i.test(t)) return '';
  return t.slice(0, max);
}

/**
 * Parse manual: "apelido: X", "bio: ...", "niver: 15/03", "titulo: Lenda", "extras: ..."
 * ou linhas soltas com keywords.
 */
export function parseProfileManual(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  const out = {};

  // Segmenta por rótulos conhecidos na mesma linha: "apelido: X niver: Y bio: Z"
  const labelRe =
    /\b(apelido|nick|nickname|bio|niver|aniversario|aniversário|aniversario|titulo|título|title|extras?|obs|notas?|conhecido\s+por|conhecida\s+por)\s*[:\-]\s*/gi;
  const parts = [];
  const labels = [...raw.matchAll(labelRe)];
  if (labels.length) {
    for (let i = 0; i < labels.length; i += 1) {
      const lab = labels[i];
      const start = lab.index + lab[0].length;
      const end = i + 1 < labels.length ? labels[i + 1].index : raw.length;
      const key = lab[1]
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const val = raw.slice(start, end).trim().replace(/[.,;]+$/, '').trim();
      parts.push({ key, val });
    }
    for (const { key, val } of parts) {
      if (!val) continue;
      if (key === 'apelido' || key === 'nick' || key === 'nickname') out.nickname = val;
      else if (key === 'bio' || key.startsWith('conhecido')) out.bio = val;
      else if (key.startsWith('niver') || key.startsWith('anivers')) out.birthday = val;
      else if (key.startsWith('titul') || key === 'title') out.title = val;
      else if (key.startsWith('extra') || key === 'obs' || key.startsWith('nota')) out.extras = val;
    }
  }

  // Frases naturais se ainda faltar campo
  if (!out.nickname) {
    const nm = raw.match(
      /(?:me\s+chamam\s+de|me\s+chamo|sou\s+o|sou\s+a)\s+["']?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ .'-]{0,30}?)(?=\s*[,.]|\s+(?:e\s|niver|bio|conhecido|anivers|fa[cç]o)|$)/i
    );
    if (nm) out.nickname = nm[1].trim();
  }
  if (!out.bio) {
    const bm = raw.match(
      /(?:conhecido\s+por|conhecida\s+por|sou\s+conhecido\s+por|sou\s+conhecida\s+por)\s+(.+?)(?=\s*[,.]|\s+niver|\s+anivers|\s+fa[cç]o|$)/i
    );
    if (bm) out.bio = bm[1].trim().replace(/\s+/g, ' ').slice(0, 200);
  }
  if (!out.birthday) {
    const dm = raw.match(
      /(?:fa[cç]o\s+)?(?:niver|anivers[aá]rio|birthday|nasci\s+em)\s*[:\-]?\s*(\d{1,2}\s*[\/\-.]\s*\d{1,2}(?:\s*[\/\-.]\s*\d{2,4})?|\d{1,2}\s*(?:de\s+)?[a-zà-úç]{3,12})/i
    );
    if (dm) out.birthday = dm[1].trim();
  }
  if (!out.title) {
    const tm = raw.match(
      /(?:t[ií]tulo|title|flair)\s*[:\-]?\s*["']?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ .'-]{0,28})/i
    );
    if (tm) out.title = tm[1].trim();
  }

  if (!out.extras) {
    const derived = deriveExtras(raw, out);
    if (derived) out.extras = derived;
  }

  return out;
}

function parseExtractJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    nickname: parsed.nickname != null ? String(parsed.nickname) : null,
    bio: parsed.bio != null ? String(parsed.bio) : null,
    birthday: parsed.birthday != null ? String(parsed.birthday) : null,
    title: parsed.title != null ? String(parsed.title) : null,
    extras:
      parsed.extras != null
        ? String(parsed.extras)
        : parsed.extra != null
          ? String(parsed.extra)
          : parsed.notes != null
            ? String(parsed.notes)
            : null,
  };
}

/**
 * MM-DD for "today" in timezone (fallback UTC-3).
 */
export function todayBirthdayMd(now = Date.now(), tz = 'America/Sao_Paulo') {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/Sao_Paulo',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA gives YYYY-MM-DD in some engines; use parts
    const parts = fmt.formatToParts(new Date(now));
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (month && day) return `${month}-${day}`;
  } catch {
    // fallback fixed -3
  }
  const d = new Date(Number(now) || Date.now());
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
  const br = new Date(utc + -3 * 60 * 60_000);
  const mo = String(br.getUTCMonth() + 1).padStart(2, '0');
  const day = String(br.getUTCDate()).padStart(2, '0');
  return `${mo}-${day}`;
}

export function yearInTz(now = Date.now(), tz = 'America/Sao_Paulo') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/Sao_Paulo',
      year: 'numeric',
    }).formatToParts(new Date(now));
    const y = parts.find((p) => p.type === 'year')?.value;
    if (y) return Number(y);
  } catch {
    /* ignore */
  }
  return new Date(now).getFullYear();
}

export function createProfileService({
  profileRepository,
  statsRepository = null,
  getContactDisplayName = null,
  getLogger = () => null,
  generateZen = openaiChatComplete,
  generateOllama = ollamaGenerate,
} = {}) {
  if (!profileRepository) throw new Error('[fun/profileService] profileRepository required');

  /** @type {Map<string, { nick: string, at: number }>} */
  const nickCache = new Map();
  const NICK_TTL = 3 * 60_000;

  function cacheKey(scopeKey, userJid) {
    return `${scopeKey}::${userJid}`;
  }

  function invalidateNick(scopeKey, userJid) {
    nickCache.delete(cacheKey(scopeKey, userJid));
  }

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.profileEnabled !== false,
      nickMax: Math.max(4, Math.min(32, Math.floor(numOr(funConfig.profileNicknameMax, 24)))),
      bioMax: Math.max(40, Math.min(240, Math.floor(numOr(funConfig.profileBioMax, 160)))),
      titleMax: Math.max(4, Math.min(32, Math.floor(numOr(funConfig.profileTitleMax ?? funConfig.titleMaxLen, 16)))),
      extrasMax: Math.max(40, Math.min(500, Math.floor(numOr(funConfig.profileExtrasMax, 280)))),
      blocklist: Array.isArray(funConfig.profileBlocklist) ? funConfig.profileBlocklist : [],
      ai: funConfig.profileAiExtract !== false,
      timeout: Math.max(5_000, Math.floor(numOr(funConfig.profileExtractTimeoutMs, 22_000))),
      tz: funConfig.profileBirthdayTz || 'America/Sao_Paulo',
      announce: funConfig.profileBirthdayAnnounce !== false,
    };
  }

  function getProfile(userJid, scopeKey) {
    const p = profileRepository.getProfile(userJid, scopeKey);
    // fallback title legado
    if (!p.title && statsRepository?.getUserStats) {
      try {
        const st = statsRepository.getUserStats(userJid, scopeKey);
        if (st?.title) p.title = String(st.title).trim();
      } catch {
        /* ignore */
      }
    }
    return p;
  }

  function getNickname(userJid, scopeKey) {
    const k = cacheKey(scopeKey, userJid);
    const hit = nickCache.get(k);
    if (hit && Date.now() - hit.at < NICK_TTL) return hit.nick;
    const nick = profileRepository.getNickname(userJid, scopeKey) || '';
    nickCache.set(k, { nick, at: Date.now() });
    return nick;
  }

  function displayName(userJid, scopeKey, getName = getContactDisplayName) {
    const nick = getNickname(userJid, scopeKey);
    if (nick) return nick;
    if (typeof getName === 'function') {
      const n = String(getName(userJid) || '').trim();
      if (n) return n;
    }
    const local = String(userJid || '').split('@')[0];
    return local || 'alguém';
  }

  /**
   * Normaliza patch bruto (nickname/bio/birthday/title) → campos válidos ou erros.
   * Campos null/undefined omitidos; "" limpa se allowClear.
   */
  function normalizePatch(rawPatch, funConfig = {}, { allowClear = true } = {}) {
    const o = opts(funConfig);
    const patch = {};
    const errors = [];
    const changed = [];

    if (rawPatch.nickname !== undefined && rawPatch.nickname !== null) {
      const v = String(rawPatch.nickname).trim();
      if (!v) {
        if (allowClear) {
          patch.nickname = '';
          changed.push('nickname');
        }
      } else {
        const s = sanitizeNickname(v, { max: o.nickMax, blocklist: o.blocklist });
        if (s.ok) {
          patch.nickname = s.value;
          changed.push('nickname');
        } else errors.push(`apelido (${s.reason})`);
      }
    }

    if (rawPatch.bio !== undefined && rawPatch.bio !== null) {
      const v = String(rawPatch.bio).trim();
      if (!v) {
        if (allowClear) {
          patch.bio = '';
          changed.push('bio');
        }
      } else {
        const s = sanitizeBio(v, { max: o.bioMax, blocklist: o.blocklist });
        if (s.ok) {
          patch.bio = s.value;
          changed.push('bio');
        } else errors.push(`bio (${s.reason})`);
      }
    }

    if (rawPatch.birthday !== undefined && rawPatch.birthday !== null) {
      const v = String(rawPatch.birthday).trim();
      if (!v) {
        if (allowClear) {
          patch.birthdayMd = '';
          changed.push('birthday');
        }
      } else {
        const b = parseBirthdayInput(v);
        if (b.ok) {
          patch.birthdayMd = b.birthdayMd;
          changed.push('birthday');
        } else errors.push(`aniversário (${b.reason})`);
      }
    }

    if (rawPatch.birthdayMd !== undefined && rawPatch.birthdayMd !== null) {
      const v = String(rawPatch.birthdayMd).trim();
      if (!v) {
        if (allowClear) {
          patch.birthdayMd = '';
          changed.push('birthday');
        }
      } else if (/^\d{2}-\d{2}$/.test(v)) {
        patch.birthdayMd = v;
        changed.push('birthday');
      }
    }

    if (rawPatch.title !== undefined && rawPatch.title !== null) {
      const v = String(rawPatch.title).trim();
      if (!v) {
        if (allowClear) {
          patch.title = '';
          changed.push('title');
        }
      } else {
        const s = sanitizeTitle(v, { max: o.titleMax, blocklist: o.blocklist });
        if (s.ok) {
          patch.title = s.value;
          changed.push('title');
        } else errors.push(`título (${s.reason})`);
      }
    }

    // extras / rawNote (mesma coluna raw_note)
    const extrasRaw =
      rawPatch.extras !== undefined && rawPatch.extras !== null
        ? rawPatch.extras
        : rawPatch.rawNote !== undefined && rawPatch.rawNote !== null
          ? rawPatch.rawNote
          : undefined;
    if (extrasRaw !== undefined) {
      const v = String(extrasRaw).trim();
      if (!v) {
        if (allowClear) {
          patch.extras = '';
          changed.push('extras');
        }
      } else {
        const s = sanitizeExtras(v, { max: o.extrasMax, blocklist: o.blocklist });
        if (s.ok) {
          patch.extras = s.value;
          changed.push('extras');
        } else errors.push(`extras (${s.reason})`);
      }
    }

    return { patch, errors, changed: [...new Set(changed)] };
  }

  function finalizeFields(raw, fields, extrasMax = 280) {
    const next = { ...fields };
    if (!next.extras || !String(next.extras).trim()) {
      const derived = deriveExtras(raw, next, { max: extrasMax });
      if (derived) next.extras = derived;
    } else {
      // evita eco: se extras só repete bio/nick, re-deriva
      const ex = String(next.extras).trim().toLowerCase();
      const bio = String(next.bio || '').trim().toLowerCase();
      const nick = String(next.nickname || '').trim().toLowerCase();
      if ((bio && ex === bio) || (nick && ex === nick)) {
        const derived = deriveExtras(raw, next, { max: extrasMax });
        next.extras = derived || null;
      }
    }
    return next;
  }

  async function extractFromText(text, funConfig = {}) {
    const o = opts(funConfig);
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, reason: 'empty', fields: {} };

    // 1) manual always as baseline
    let fields = parseProfileManual(raw);

    // 2) AI if enabled
    if (o.ai && process.env.FUN_DISABLE_LIVE_LLM !== '1') {
      const prompt = `Texto do usuário:\n"""${raw.slice(0, 800)}"""\n\nExtraia nickname, bio, birthday, title e extras (resto) em JSON.`;

      if (funConfig.zenEnabled !== false) {
        try {
          const task = resolveZenTaskParams('extract', funConfig);
          const out = await generateZen({
            baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3300',
            model: funConfig.zenModel || 'glm_5_2',
            system: EXTRACT_SYSTEM,
            prompt,
            timeoutMs: Math.max(o.timeout, task.timeoutMs),
            maxTokens: task.maxTokens,
            temperature: task.temperature,
            apiKey: funConfig.zenApiKey || '',
            jsonMode: true,
            jsonOnly: true,
            sendSamplingParams: funConfig.zenSendSamplingParams === true,
          });
          const parsed = parseExtractJson(out);
          if (parsed) {
            fields = finalizeFields(
              raw,
              {
                nickname: parsed.nickname ?? fields.nickname,
                bio: parsed.bio ?? fields.bio,
                birthday: parsed.birthday ?? fields.birthday,
                title: parsed.title ?? fields.title,
                extras: parsed.extras ?? fields.extras,
              },
              o.extrasMax
            );
            recordLlmHit('profile', 'zen', {});
            return { ok: true, fields, source: 'zen' };
          }
        } catch (err) {
          getLogger?.()?.debug?.(
            { err: { message: err?.message || 'zen-profile' } },
            'profile AI zen fail'
          );
        }
      }

      if (funConfig.ollamaEnabled !== false) {
        try {
          const out = await generateOllama({
            baseUrl: funConfig.ollamaBaseUrl || 'http://127.0.0.1:11434',
            model: funConfig.ollamaModel || 'gemma4:latest',
            system: EXTRACT_SYSTEM,
            prompt,
            timeoutMs: o.timeout,
            keepAlive: funConfig.ollamaKeepAlive ?? -1,
            think: false,
            numPredict: 280,
            temperature: 0.3,
            format: 'json',
          });
          const parsed = parseExtractJson(out);
          if (parsed) {
            fields = finalizeFields(
              raw,
              {
                nickname: parsed.nickname ?? fields.nickname,
                bio: parsed.bio ?? fields.bio,
                birthday: parsed.birthday ?? fields.birthday,
                title: parsed.title ?? fields.title,
                extras: parsed.extras ?? fields.extras,
              },
              o.extrasMax
            );
            return { ok: true, fields, source: 'ollama' };
          }
        } catch (err) {
          getLogger?.()?.debug?.(
            { err: { message: err?.message || 'ollama-profile' } },
            'profile AI ollama fail'
          );
        }
      }
    }

    fields = finalizeFields(raw, fields, o.extrasMax);
    const has =
      fields.nickname || fields.bio || fields.birthday || fields.title || fields.extras;
    return { ok: Boolean(has), fields, source: has ? 'manual' : 'none' };
  }

  async function applyFreeText({
    userJid,
    scopeKey,
    text,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };

    const extracted = await extractFromText(text, funConfig);
    if (!extracted.ok) {
      return {
        ok: false,
        reason: 'nothing-parsed',
        hint: 'Ex.: me chamam de Nina, sou a das figurinhas, niver 12/08, extras: torço pro time X',
      };
    }

    // nulls from AI → omit (merge); only defined fields
    const rawPatch = {};
    if (extracted.fields.nickname != null && String(extracted.fields.nickname).trim() !== '') {
      rawPatch.nickname = extracted.fields.nickname;
    }
    if (extracted.fields.bio != null && String(extracted.fields.bio).trim() !== '') {
      rawPatch.bio = extracted.fields.bio;
    }
    if (extracted.fields.birthday != null && String(extracted.fields.birthday).trim() !== '') {
      rawPatch.birthday = extracted.fields.birthday;
    }
    if (extracted.fields.title != null && String(extracted.fields.title).trim() !== '') {
      rawPatch.title = extracted.fields.title;
    }
    if (extracted.fields.extras != null && String(extracted.fields.extras).trim() !== '') {
      rawPatch.extras = extracted.fields.extras;
    }

    const { patch, errors, changed } = normalizePatch(rawPatch, funConfig, {
      allowClear: false,
    });
    if (!changed.length) {
      return {
        ok: false,
        reason: 'invalid-fields',
        errors,
        hint: 'Não consegui validar os dados. Tente de novo com apelido e niver claros.',
      };
    }

    const result = profileRepository.upsertProfile({
      userJid,
      scopeKey,
      nickname: patch.nickname,
      bio: patch.bio,
      birthdayMd: patch.birthdayMd,
      title: patch.title,
      extras: patch.extras,
      now,
    });
    invalidateNick(scopeKey, userJid);

    // espelha title em stats se existir (compat ranks antigos)
    if (patch.title !== undefined && statsRepository?.setTitle) {
      try {
        statsRepository.setTitle({
          userJid,
          scopeKey,
          title: patch.title,
          now,
        });
      } catch {
        /* ignore */
      }
    }

    return {
      ok: true,
      profile: result.profile,
      changed,
      errors,
      source: extracted.source,
    };
  }

  function setTitle({ userJid, scopeKey, title, funConfig = {}, now = Date.now() }) {
    const { patch, errors } = normalizePatch({ title }, funConfig, { allowClear: false });
    if (!patch.title) {
      return { ok: false, reason: 'title-required', errors };
    }
    const result = profileRepository.upsertProfile({
      userJid,
      scopeKey,
      title: patch.title,
      now,
    });
    if (statsRepository?.setTitle) {
      statsRepository.setTitle({ userJid, scopeKey, title: patch.title, now });
    }
    invalidateNick(scopeKey, userJid);
    return { ok: true, profile: result.profile, title: patch.title };
  }

  function clearOwn({ userJid, scopeKey, now = Date.now() }) {
    const result = profileRepository.clearProfile(userJid, scopeKey, now);
    if (statsRepository?.setTitle) {
      try {
        statsRepository.setTitle({ userJid, scopeKey, title: '', now });
      } catch {
        /* ignore */
      }
    }
    invalidateNick(scopeKey, userJid);
    return result;
  }

  function adminReset({ userJid, scopeKey, now = Date.now() }) {
    return clearOwn({ userJid, scopeKey, now });
  }

  function buildIdentityBlock(scopeKey, userJids = [], funConfig = {}) {
    const o = opts(funConfig);
    if (!o.enabled || !scopeKey) return '';
    const lines = [];
    for (const jid of userJids || []) {
      if (!jid) continue;
      const p = getProfile(jid, scopeKey);
      if (p.empty) continue;
      const wa =
        typeof getContactDisplayName === 'function'
          ? String(getContactDisplayName(jid) || '').trim()
          : '';
      const label = p.nickname || wa || String(jid).split('@')[0];
      const bits = [];
      if (p.nickname && wa && p.nickname !== wa) bits.push(`nick: ${p.nickname}`);
      if (p.bio) bits.push(p.bio);
      if (p.birthdayMd) bits.push(`niver ${formatBirthdayDisplay(p.birthdayMd)}`);
      if (p.title) bits.push(`título: ${p.title}`);
      if (p.extras) bits.push(`extras: ${String(p.extras).slice(0, 120)}`);
      if (!bits.length) continue;
      lines.push(`- ${label}: ${bits.join(' · ')}`);
    }
    if (!lines.length) return '';
    return ['<user_identity>', 'Identidade do grupo (não invente além disso):', ...lines, '</user_identity>'].join(
      '\n'
    );
  }

  /**
   * Anúncios de aniversário para um scope. Caller envia msgs.
   */
  function listBirthdayAnnouncements(scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    if (!o.enabled || !o.announce) return [];
    const md = todayBirthdayMd(now, o.tz);
    const year = yearInTz(now, o.tz);
    const rows = profileRepository.listBirthdaysOn(scopeKey, md);
    const out = [];
    for (const p of rows) {
      if (profileRepository.wasBirthdayAnnounced(scopeKey, p.userJid, year)) continue;
      out.push({
        userJid: p.userJid,
        nickname: p.nickname,
        birthdayMd: p.birthdayMd,
        year,
        display: formatBirthdayDisplay(p.birthdayMd),
      });
    }
    return out;
  }

  function markBirthdayAnnounced(scopeKey, userJid, year, now = Date.now()) {
    profileRepository.markBirthdayAnnounced(scopeKey, userJid, year, now);
  }

  return {
    getProfile,
    getNickname,
    displayName,
    applyFreeText,
    extractFromText,
    setTitle,
    clearOwn,
    adminReset,
    buildIdentityBlock,
    listBirthdayAnnouncements,
    markBirthdayAnnounced,
    normalizePatch,
    parseProfileManual,
    parseBirthdayInput,
    formatBirthdayDisplay,
    invalidateNick,
    opts,
  };
}
