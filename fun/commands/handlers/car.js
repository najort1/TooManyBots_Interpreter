import { CAR_MESSAGES } from '../../messages/car.js';
import { formatCarLink, formatMyCarCaption } from '../../formatters/car.js';
import { getPublicBaseUrl } from '../../utils/publicUrl.js';
import {
  CAR_PRESETS,
  calculateCarPerformance,
  generateDynoCurve,
} from '../../../shared/car/domain.js';

/**
 * Handler do comando /carro.
 * - Em grupo: instrui o usuário a abrir o privado.
 * - No privado: se usuário não possuir carro comprado, nada acontece. Se possuir, envia link privado ou atende subcomandos (dyno, presets, revogar).
 */
export async function handleCarCommand({
  isGroup,
  scopeKey,
  userJid,
  carService,
  carLinkService,
  getContactDisplayName,
  repository,
  prefsRepository,
  identityMap,
  funConfig = {},
  reply,
  args = [],
}) {
  if (funConfig.carEnabled === false) {
    await reply(CAR_MESSAGES.disabled);
    return { handled: true };
  }

  if (isGroup) {
    await reply(CAR_MESSAGES.groupDmHint);
    return { handled: true };
  }

  if (!carService || !carLinkService) {
    await reply(CAR_MESSAGES.disabled);
    return { handled: true };
  }

  const sub = String(args[0] || 'link').trim().toLowerCase();

  // Em DM: resolve escopo efetivo caso o usuário tenha carro em outro grupo
  let effectiveScopeKey = scopeKey;
  let hasCar = carService.ownsCar({ scopeKey: effectiveScopeKey, userJid, identityMap });

  if (!hasCar && typeof carService.findCarScope === 'function') {
    const lookup = carService.findCarScope({ userJid, preferredScopeKey: scopeKey, identityMap });
    if (lookup?.owns && lookup.scopeKey) {
      effectiveScopeKey = lookup.scopeKey;
      hasCar = true;
      try {
        prefsRepository?.setPreferredScope?.(userJid, effectiveScopeKey);
      } catch {
        // non-fatal
      }
    } else if (lookup?.condition === 'broken') {
      await reply(CAR_MESSAGES.carBroken);
      return { handled: true, reason: 'car-broken' };
    }
  }

  if (!hasCar) {
    await reply(CAR_MESSAGES.noCarOwned);
    return { handled: true, reason: 'car-not-owned' };
  }

  // Subcomando: revogar link
  if (sub === 'revogar' || sub === 'revogar-link') {
    carLinkService.revoke({ scopeKey: effectiveScopeKey, userJid });
    await reply('🔐 Link da sua garagem revogado. Use /carro para gerar outro link.');
    return { handled: true };
  }

  // Subcomando: dyno / dinamômetro
  if (sub === 'dyno' || sub === 'dinamometro') {
    const carInfo = carService.getCarState({ scopeKey: effectiveScopeKey, userJid });
    const perf = calculateCarPerformance(carInfo.state);
    const dyno = generateDynoCurve(carInfo.state);
    const ownerName = getContactDisplayName?.(userJid) || 'Piloto';

    const msg = [
      '📊 *BANCADA DINAMOMÉTRICA (DYNO TEST)*',
      `Piloto: *${ownerName}* | Placa: *${carInfo.state.plateText || 'TMB-2026'}*`,
      `Classificação: *PR ${perf.prScore}*`,
      '',
      `💥 *Potência de Pico:* ${dyno.peakHp} cv @ 7.000 RPM`,
      `⚡ *Torque Máximo:* ${dyno.peakTorque} Nm @ 4.500 RPM`,
      `⏱️ *0 a 100 km/h:* ${perf.zeroToHundredSec}s | *Vel. Máx:* ${perf.topSpeedKmh} km/h`,
      `🛡️ *Aderência & Handling:* ${perf.handling}/100`,
      `🎨 *Índice de Estilo:* ${perf.styleScore}/100`,
      '',
      '💡 _Use /carro para abrir a oficina 3D e instalar novos kits de performance!_',
    ].join('\n');

    await reply(msg);
    return { handled: true, dyno, perf };
  }

  // Subcomando: presets lendários
  if (sub === 'presets' || sub === 'estilos') {
    const list = CAR_PRESETS.map(
      (p) => `⭐ *${p.name}*\n   _${p.description}_`
    ).join('\n\n');

    const msg = [
      '🏆 *PRESETS DE PILOTOS LENDÁRIOS*',
      '',
      list,
      '',
      '💡 _Aplique esses presets com 1 clique acessando sua oficina 3D com /carro._',
    ].join('\n');

    await reply(msg);
    return { handled: true, presets: CAR_PRESETS };
  }

  // Link padrão da oficina 3D
  const carInfo = carService.getCarState({ scopeKey: effectiveScopeKey, userJid });
  const link = await carLinkService.generate({ scopeKey: effectiveScopeKey, userJid });
  const coins = repository?.getUserStats?.(userJid, effectiveScopeKey)?.coins ?? carInfo.coins;
  const baseUrl = getPublicBaseUrl(funConfig);
  const url = `${baseUrl}/carros/${link.token}`;

  await reply(
    formatCarLink({
      url,
      coins,
      groupName: effectiveScopeKey,
      carState: carInfo.state,
    })
  );

  return { handled: true, carState: carInfo.state, url, scopeKey: effectiveScopeKey };
}

/**
 * Handler do comando meu_carro (ou /meu_carro).
 * Gera e envia screenshot do carro customizado atual do usuário (apenas se possuir carro).
 */
export async function handleMyCarCommand({
  isGroup,
  scopeKey,
  userJid,
  carService,
  getContactDisplayName,
  repository,
  prefsRepository,
  identityMap,
  funConfig = {},
  reply,
  replyImage,
  replyImageUrl,
  args = [],
}) {
  if (funConfig.carEnabled === false) {
    await reply(CAR_MESSAGES.disabled);
    return { handled: true };
  }

  if (!carService) {
    await reply(CAR_MESSAGES.disabled);
    return { handled: true };
  }

  // Em DM: resolve escopo efetivo caso o usuário tenha carro em outro grupo
  let effectiveScopeKey = scopeKey;
  let hasCar = carService.ownsCar({ scopeKey: effectiveScopeKey, userJid, identityMap });

  if (!hasCar && !isGroup && typeof carService.findCarScope === 'function') {
    const lookup = carService.findCarScope({ userJid, preferredScopeKey: scopeKey, identityMap });
    if (lookup?.owns && lookup.scopeKey) {
      effectiveScopeKey = lookup.scopeKey;
      hasCar = true;
      try {
        prefsRepository?.setPreferredScope?.(userJid, effectiveScopeKey);
      } catch {
        // non-fatal
      }
    } else if (lookup?.condition === 'broken') {
      await reply(CAR_MESSAGES.carBroken);
      return { handled: true, reason: 'car-broken' };
    }
  }

  if (!hasCar) {
    await reply(CAR_MESSAGES.noCarOwned);
    return { handled: true, reason: 'car-not-owned' };
  }

  const sub = String(args[0] || '').trim().toLowerCase();
  if (sub === 'dyno' || sub === 'dinamometro') {
    const carInfo = carService.getCarState({ scopeKey: effectiveScopeKey, userJid });
    const perf = calculateCarPerformance(carInfo.state);
    const dyno = generateDynoCurve(carInfo.state);
    const ownerName = getContactDisplayName?.(userJid) || 'Piloto';

    const msg = [
      '📊 *BANCADA DINAMOMÉTRICA (DYNO TEST)*',
      `Piloto: *${ownerName}* | Placa: *${carInfo.state.plateText || 'TMB-2026'}*`,
      `Classificação: *PR ${perf.prScore}*`,
      '',
      `💥 *Potência de Pico:* ${dyno.peakHp} cv @ 7.000 RPM`,
      `⚡ *Torque Máximo:* ${dyno.peakTorque} Nm @ 4.500 RPM`,
      `⏱️ *0 a 100 km/h:* ${perf.zeroToHundredSec}s | *Vel. Máx:* ${perf.topSpeedKmh} km/h`,
      `🛡️ *Aderência & Handling:* ${perf.handling}/100`,
      `🎨 *Índice de Estilo:* ${perf.styleScore}/100`,
    ].join('\n');

    await reply(msg);
    return { handled: true, dyno, perf };
  }

  const carInfo = carService.getCarState({ scopeKey: effectiveScopeKey, userJid });
  const ownerName = getContactDisplayName?.(userJid) || 'Piloto';
  const coins = repository?.getUserStats?.(userJid, effectiveScopeKey)?.coins ?? carInfo.coins;
  const caption = formatMyCarCaption({
    carState: carInfo.state,
    ownerName,
    coins,
  });

  const renderResult = await carService.renderCarScreenshot({
    scopeKey: effectiveScopeKey,
    userJid,
    ownerName,
  });

  if (!renderResult?.ok || !renderResult.buffer) {
    await reply(caption);
    return { handled: true, rendered: false };
  }

  if (typeof replyImage === 'function') {
    await replyImage(renderResult.buffer, caption);
  } else if (typeof replyImageUrl === 'function') {
    const baseUrl = getPublicBaseUrl(funConfig);
    const imageUrl = `${baseUrl}/api/fun/cars/render?scopeKey=${encodeURIComponent(effectiveScopeKey)}&userJid=${encodeURIComponent(userJid)}`;
    await replyImageUrl(imageUrl, caption, 'image/png');
  } else {
    await reply(caption);
  }

  return { handled: true, rendered: true, buffer: renderResult.buffer, scopeKey: effectiveScopeKey };
}
