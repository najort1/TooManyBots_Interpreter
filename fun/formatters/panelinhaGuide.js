/**
 * Texto do guia de facções / panelinha (enviado no privado).
 */

export function formatPanelinhaGuide(prefix = '/', funConfig = {}) {
  const p = String(prefix || '/');
  const minActions = funConfig.bridgeMinActions || 10;
  const debuffPct = Math.round((funConfig.bridgeDebuffThreshold ?? 0.25) * 100);
  const dailyMult = funConfig.bridgeDebuffXpMult ?? 0.9;
  const maxMembers = funConfig.factionMaxMembers || 8;
  const createCost = funConfig.factionCreateCost ?? 50;
  const leaveCost = funConfig.factionLeaveCost ?? 25;

  return [
    '🏴‍☠️ *Guia: Facções & Panelinha*',
    '',
    'Isto vira a “panelinha” do grupo em *jogo público* — com placar, cofre e incentivo pra misturar gente.',
    '',
    '─── *O que é uma facção?* ───',
    'Um time oficial no *mesmo grupo* do WhatsApp:',
    '• Nome, líder, membros (máx. ' + maxMembers + ')',
    '• Cofre de coins (doações)',
    '• *Ponte Social* (quão abertos vocês são pro resto do chat)',
    '',
    `Criar: \`${p}faccao criar Nome\` (custa ~${createCost} coins)`,
    `Entrar: \`${p}faccao entrar Nome\``,
    `Doar: \`${p}faccao doar 50\``,
    `Sair: \`${p}faccao sair\` (taxa ~${leaveCost} coins)`,
    `Info / rank: \`${p}faccao info\` · \`${p}faccao rank\``,
    '',
    '─── *Ponte Social* ───',
    'É a % de interações da facção com gente *de fora* do time, na semana:',
    '',
    '  Ponte = ações com *outra facção* (ou sem facção)',
    '          ÷ todas as ações da facção',
    '',
    'Contam ações como:',
    '• `/pay` · `/aposta` · `/ship` · casar · missão mista',
    '',
    `• *Interna* = só entre membros do mesmo time`,
    `• *Externa* = envolve alguém de fora`,
    '',
    `Precisa de pelo menos *${minActions} ações* na semana pra score “valer”.`,
    `Se a ponte ficar *abaixo de ${debuffPct}%* → debuff leve no XP do \`/daily\` (×${dailyMult}).`,
    '',
    'Ver a sua: `' + p + 'ponte`',
    '',
    '─── *Ranking “só joga no círculo”* ───',
    'Comando: `' + p + 'panelinha`',
    '',
    'Não é ranking de “quem é amigo de quem na vida real”.',
    'É o placar de *facções que mais jogam só entre si* no bot, nesta semana.',
    '',
    '• *1º lugar* = pior ponte = mais “clube fechado”',
    '  (quase só pay/aposta/ship dentro do próprio time)',
    '• *Últimos* = mais misturam com o resto do grupo',
    '',
    'Exemplo:',
    '  Fundão: 20 ações internas + 2 externas → ponte ~9% → panelinha forte',
    '  Restos: 5 internas + 15 externas → ponte ~75% → abertos',
    '',
    'O bot *expõe* isso com zoeira — e recompensa quem sobe a ponte',
    '(missões mistas, evento relâmpago, rank de facção).',
    '',
    '─── *Missões mistas* ───',
    '`' + p + 'missao spawn` monta um squad com gente de *facções diferentes*.',
    'Objetivos típicos: daily do squad, aposta entre membros, ship.',
    'Não fecha só com a sua panelinha.',
    '',
    '─── *Evento relâmpago* ───',
    '`' + p + 'evento` — status. O *bot sorteia* trégua falsa / happy hour sozinho.',
    '(`/pay`, `/aposta`, `/ship`) dá bônus de coins/XP.',
    '',
    '─── *Resumo* ───',
    '1. Crie ou entre numa facção',
    '2. Doem pro cofre se quiserem força coletiva',
    '3. Não fiquem só entre vocês — senão o `/panelinha` te zoa',
    '4. Façam missão e evento pra misturar o chat',
    '',
    'Comandos úteis: `' + p + 'faccao\` · `' + p + 'panelinha\` · `' + p + 'ponte\` · `' + p + 'missao\` · `' + p + 'evento\`',
  ].join('\n');
}
