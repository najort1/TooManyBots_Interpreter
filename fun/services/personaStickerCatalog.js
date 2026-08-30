/**
 * Catálogo de figurinhas exclusivas do bot.
 *
 * Mapeia situações/emoções → arquivos em fun/assets/figurinhas/.
 * O LLM recebe apenas os slugs válidos; o executor resolve o caminho
 * real no disco — o modelo nunca vê o filesystem.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIGURINHAS_DIR = path.resolve(__dirname, '..', 'assets', 'figurinhas');

/**
 * Mapeamento slug → nome de arquivo (sem extensão).
 * Mantém os nomes exatos dos arquivos presentes em fun/assets/figurinhas/.
 */
export const STICKER_CATALOG = {
  // Risada / Zoeira
  rindo_muito:    'rindo_muito',
  cara_de_pau:    'cara_de_pau',
  deboche:        'deboxe',          // arquivo tem typo original — mantemos
  discordo:       'discordo',

  // Concordância / Hype
  joinha:         'joinha',
  legal:          'legal_2',

  // Discordância / Ironia
  seila:          'seila',

  // Respostas rápidas / neutras
  indo_embora:    'indo_embora',
  sono:           'sono',
  curioso:        'curioso',
  pedindo:        'pedindo',

  // Empatia / consolo
  triste:         'triste',
  muito_triste:   'muito_triste',
  vai_melhorar:   'vai_melhorar',

  // Dúvida / reflexão
  pensativo:      'pensativo',
  entendi_nada:   'entendi_nada',

  // Reações de impacto
  chocado:        '01_chocado',
  que_absurdo:    '02_que_absurdo',
  isso_e_demais:  '03_isso_e_demais',
  meu_deus:       '04_meu_deus',
  que_situacao:   '05_que_situacao',

  // Atitude / personalidade do bot
  confiante:      '01_confiante_estilo',
  to_por_dentro:  '02_to_por_dentro',
  pode_deixar:    '03_pode_deixar_comigo',
  mandando_ver:   '04_mandando_ver',
  ja_sabia:       '05_ja_sabia',
  dando_conselho: '06_dando_conselho',

  // Celebração / contexto especial
  parabens:       '01_parabens_comemorando',
  ganhamos:       '02_ganhamos_vitoria',
  sextou:         '03_fim_de_semana_sextou',
  feriado:        '04_feriado_animado',
  aniversario:    '05_aniversario_festinha',

  // Flerte / clima adulto contextual
  piscadinha:     '01_piscadinha_safadinho',
  malicioso:      '02_que_isso_hein_malicioso',
  charmoso:       '03_galanteador_charmoso',
  corado:         '04_envergonhado_corado',

  // Horário / energia
  cansado:        '01_cansado_dormindo',
  madrugada:      '02_madrugada_zumbi',
  sumindo:        '03_to_sumido_sumindo',
  voltei:         '04_voltei_aparecendo',
};

/** Lista pública de slugs para expor ao LLM no manifesto. */
export const STICKER_SLUGS = Object.keys(STICKER_CATALOG);

/** Extensões aceitas, em ordem de preferência. */
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/**
 * Resolve o caminho absoluto de uma figurinha pelo slug.
 * Retorna `null` se o slug for inválido ou nenhum arquivo com extensão válida existir.
 *
 * @param {string} slug
 * @returns {string|null}
 */
export function resolveStickerPath(slug) {
  const base = STICKER_CATALOG[String(slug || '').trim()];
  if (!base) return null;

  for (const ext of EXTENSIONS) {
    const full = path.join(FIGURINHAS_DIR, `${base}${ext}`);
    if (existsSync(full)) return full;
  }
  return null;
}
