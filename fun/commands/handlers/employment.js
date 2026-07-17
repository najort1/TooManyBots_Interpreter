/**
 * /emprego · /demitir — profissões com teste web.
 * Tudo no grupo (sem DM — WhatsApp restringe bot por spam).
 */

import { nameOf } from '../../utils/userLabel.js';

function formatRetry(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export async function handleEmploymentCommand({
  userJid,
  scopeKey,
  jobService,
  funConfig,
  getContactDisplayName,
  reply,
  args = [],
}) {
  if (!jobService) {
    await reply('Empregos indisponíveis.');
    return { handled: true };
  }

  const sub = String(args[0] || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!sub || ['lista', 'list', 'help', 'ajuda'].includes(sub)) {
    await reply(jobService.formatJobList(scopeKey, userJid));
    return { handled: true };
  }

  if (['codigo', 'code', 'link', 'reenviar'].includes(sub)) {
    await reply(
      'Peça de novo com `/emprego bombeiro` (ou outro cargo). O link anterior expira em 15 min.'
    );
    return { handled: true };
  }

  const result = jobService.startApplication({
    userJid,
    scopeKey,
    jobId: sub,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'unknown-job') {
      await reply('Cargo desconhecido. Use `/emprego` pra ver a lista.');
      return { handled: true };
    }
    if (result.reason === 'already-employed') {
      await reply(
        `Você já tem emprego (*${result.jobId}*). \`/demitir sim\` pra sair antes de candidatar a outro.`
      );
      return { handled: true };
    }
    if (result.reason === 'cooldown') {
      await reply(
        `CD deste cargo. Próxima tentativa em *${formatRetry(result.retryInMs)}*.`
      );
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(
        `Taxa de retentativa *${result.fee}*c · você tem *${result.coins}*c.`
      );
      return { handled: true };
    }
    await reply('Não deu pra abrir o teste. Tente de novo.');
    return { handled: true };
  }

  const who = nameOf(getContactDisplayName, userJid);
  const job = result.job;

  // Tudo no grupo — link + código na mesma mensagem (sem DM)
  await reply(
    [
      `💼 *${who}* vai tentar o teste de *${job.name}*.`,
      '',
      `${job.emoji} *Link do teste* (abre no celular):`,
      result.link,
      '',
      `Código: *${result.code}*`,
      `Expira em *15 min*.`,
      result.fee > 0 ? `Taxa: *${result.fee}*c` : '_1ª tentativa grátis_',
      '',
      '_Resultado só na página do teste — o grupo não recebe pass/fail._',
    ].join('\n')
  );

  return { handled: true, result };
}

export async function handleResignCommand({
  userJid,
  scopeKey,
  jobService,
  reply,
  args = [],
}) {
  if (!jobService) {
    await reply('Empregos indisponíveis.');
    return { handled: true };
  }

  const confirm = String(args[0] || '')
    .trim()
    .toLowerCase();
  if (!['sim', 'yes', 'confirmar', 'ok'].includes(confirm)) {
    const emp = jobService.getEmployment(userJid, scopeKey);
    if (!emp) {
      await reply('Você não tem carteira assinada. `/emprego` pra ver cargos.');
      return { handled: true };
    }
    await reply(
      [
        `Pedir demissão de *${emp.job.name}*?`,
        'Confirme: `/demitir sim`',
        '_Salário no daily some na hora._',
      ].join('\n')
    );
    return { handled: true };
  }

  const result = jobService.resign({ userJid, scopeKey });
  if (!result.ok) {
    await reply('Você não tem emprego ativo.');
    return { handled: true };
  }
  await reply(
    `🪪 Demissão registrada (*${result.previousJobId}*). Bem-vindo de volta ao freela (\`/trabalhar\`).`
  );
  return { handled: true, result };
}
