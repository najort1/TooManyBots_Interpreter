import { calculateCarPerformance } from '../../shared/car/domain.js';

export function formatCarLink({ groupName = '', url, coins = 0, carState = {} }) {
  const perf = calculateCarPerformance(carState);
  const parts = [
    '🏎️ *Sua Garagem VIP' + (groupName ? ' — ' + groupName : '') + '*',
    'Placa: *' + (carState.plateText || 'TMB-2026') + '* | Classificação: *PR ' + perf.prScore + '*',
    'Motor: *' + perf.horsepower + ' cv* | 0-100: *' + perf.zeroToHundredSec + 's* | Top: *' + perf.topSpeedKmh + ' km/h*',
    'Saldo: *' + coins + ' coins*',
    '',
    '🔗 *Link de customização 3D:*',
    url,
    '',
    '✨ _Oficina completa: bodykits, pintura perolizada/fosca, suspensão, rodas, neon e áudio do motor._',
  ];
  return parts.join('\n');
}

export function formatMyCarCaption({ carState = {}, ownerName = '', coins = 0 }) {
  const perf = calculateCarPerformance(carState);
  const lines = [
    '🏎️ *Garagem VIP de ' + (ownerName || 'Piloto') + '* [PR ' + perf.prScore + ']',
    'Placa: *' + (carState.plateText || 'TMB-2026') + '* | Kit: *' + (carState.bodykit || 'stock').toUpperCase() + '*',
    'Potência: *' + perf.horsepower + ' cv* | 0-100: *' + perf.zeroToHundredSec + 's* | Top: *' + perf.topSpeedKmh + ' km/h*',
    'Rodas: *' + (carState.wheels || 'sport').toUpperCase() + '* | Altura: *' + (carState.suspension || 'normal').toUpperCase() + '*',
    'Spoiler: *' + (carState.spoiler || 'none').toUpperCase() + '* | Neon: *' + (carState.neon || 'none').toUpperCase() + '*',
    'Pintura: *' + (carState.finish || 'glossy').toUpperCase() + '* | Decalque: *' + (carState.decal || 'none').toUpperCase() + '*',
    '',
    '💡 _Use /carro no privado para abrir a oficina 3D e tunar seu bólido!_',
  ];
  return lines.join('\n');
}
