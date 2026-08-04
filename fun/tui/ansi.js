/**
 * Helpers ANSI autocontidos — base para o renderer e o loop da TUI.
 * Zero dependências; compatíveis com Windows Terminal / iTerm2 / kitty.
 *
 * Princípios:
 * - Sequências só são emitidas quando `process.stdout.isTTY` (ver `isAnsiAllowed()`).
 * - Nenhuma mutação global de stdout; tudo é função pura de string.
 * - Reset (`\x1b[0m`) sempre acompanha cores/estilos para não vazar.
 */

/** Sequência CSI/SGR para resetar estilo. */
export const RESET = '\x1b[0m';

/** Cores SGR (foreground). */
export const FG = Object.freeze({
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightCyan: '\x1b[96m',
  brightYellow: '\x1b[93m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
});

/** Estilos SGR (atributos). */
export const STYLE = Object.freeze({
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  inverse: '\x1b[7m',
});

/**
 * @returns {boolean} true se é seguro emitir sequências ANSI no stdout.
 */
export function isAnsiAllowed() {
  return Boolean(process.stdout && process.stdout.isTTY);
}

/** Entra no alternate screen buffer e esconde o cursor. */
export const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[?25l';
/** Restaura a tela principal e mostra o cursor. */
export const EXIT_ALT_SCREEN = '\x1b[?25h\x1b[?1049l';

/** Move o cursor para 1,1 (topo-esquerda) — usado antes de redesenhar. */
export const CURSOR_HOME = '\x1b[H';
/** Limpa a tela inteira. */
export const CLEAR_SCREEN = '\x1b[2J';

/**
 * Compõe uma string ANSI: prefixo + texto + reset.
 * Se ANSI não for permitido no stdout atual, retorna só o texto.
 *
 * @param {string} prefix código SGR (cor/estilo) ou múltiplos concatenados
 * @param {string} text texto a envolver
 * @param {object} [opts]
 * @param {boolean} [opts.allow] sobrescreve `isAnsiAllowed()` (testes)
 */
export function paint(prefix, text, opts = {}) {
  const allow = opts.allow != null ? Boolean(opts.allow) : isAnsiAllowed();
  const body = String(text ?? '');
  if (!allow || !body) return body;
  return `${String(prefix || '')}${body}${RESET}`;
}

/**
 * Trunca uma string pelo número de caracteres (medido em colunas visíveis
 * ignorando sequências ANSI já presentes).
 *
 * @param {string} text
 * @param {number} max
 */
export function truncate(text, max) {
  const t = String(text ?? '');
  if (max <= 0) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Remove pares de caracteres `\r\n` no final (evita "linhas puladas" em alguns terminais).
 * @param {string} text
 */
export function stripTrailingNewlines(text) {
  return String(text ?? '').replace(/(\r?\n)+$/, '');
}

/**
 * Repete um caractere n vezes (semelhante a `String.prototype.repeat`, mas seguro p/ n=0).
 * @param {string} ch
 * @param {number} n
 */
export function repeat(ch, n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (count === 0) return '';
  return String(ch || ' ').repeat(count);
}

/**
 * Pad centralizado até largura `width` (em caracteres, ignorando ANSI).
 * @param {string} text
 * @param {number} width
 * @param {string} [pad=' ']
 */
export function padCenter(text, width, pad = ' ') {
  const t = String(text ?? '');
  if (t.length >= width) return t;
  const total = width - t.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return `${repeat(pad, left)}${t}${repeat(pad, right)}`;
}
