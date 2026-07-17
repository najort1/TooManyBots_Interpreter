/**
 * Texto do guia de panelinhas (ex-facções).
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
    '🏴‍☠️ *Guia: Panelinhas*',
    '',
    'Isto vira a “panelinha” do grupo em *jogo público* — com placar, cofre e incentivo pra misturar gente.',
    '',
    '─── *O que é uma panelinha?* ───',
    'Um time oficial no *mesmo grupo* do WhatsApp:',
    '• Nome, líder, membros (máx. ' + maxMembers + ')',
    '• Cofre de coins (doações)',
    '• *Ponte Social* (quão abertos vocês são pro resto do chat)',
    '',
    `Criar: \`${p}panelinha criar Nome\` (custa ~${createCost} coins)`,
    `Entrar: \`${p}panelinha entrar Nome\``,
    `Doar: \`${p}panelinha doar 50\``,
    `Sair: \`${p}panelinha sair\` (taxa ~${leaveCost} coins)`,
    `Info / rank: \`${p}panelinha info\` · \`${p}panelinha rank\``,
    `Relatório CIA: \`${p}panelinha\` (quem se isola)`,
    '',
    '─── *Ponte Social* ───',
    'É a % de interações da panelinha com gente *de fora* do time, na semana:',
    '',
    '  Ponte = ações com *outra panelinha* (ou sem panelinha)',
    '          ÷ todas as ações da panelinha',
    '',
    'Contam ações como:',
    '• `/pay` · `/aposta` · `/ship` · casar · missão mista',
    '',
    `• *Interna* = só entre membros do mesmo time`,
    `• Mínimo ~${minActions} ações/semana pra ter placar`,
    `• Abaixo de *${debuffPct}%* de ponte → debuff no daily (×${dailyMult} XP)`,
    '',
    'Comando: `' + p + 'panelinha` (relatório) · `' + p + 'ponte`',
    '',
    '─── *Exemplos de placar* ───',
    '  Abertos: 10 internas + 20 externas → ponte alta → sem debuff',
    '  Fundão: 20 ações internas + 2 externas → ponte baixa → debuff',
    '',
    '─── *Por que misturar?* ───',
    'Isolado perde meta de missões, eventos e rank de panelinha.',
    '',
    '─── *Como começar* ───',
    '1. Crie ou entre numa panelinha',
    '2. Doe pro cofre se quiser',
    '3. Não fiquem só entre vocês — senão o relatório te zoa',
    '',
    'Comandos úteis: `' +
      p +
      'panelinha` · `' +
      p +
      'ponte` · `' +
      p +
      'missao` · `' +
      p +
      'evento`',
  ].join('\n');
}
