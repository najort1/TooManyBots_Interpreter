/**
 * Mensagens padronizadas de economia — compras, transferências, saldo.
 */

/**
 * @param {{ item: string, cost: number, balance: number, emoji?: string }} opts
 */
export function purchaseComplete({ item, cost, balance, emoji } = {}) {
  const e = emoji || '✅';
  return [
    `${e} *Compra concluída*`,
    `${e} *${item}* — *${cost}*c`,
    `Saldo: *${balance}*c`,
  ].join('\n');
}

/**
 * @param {{ to: string, amount: number, fromBalance: number, toBalance?: number }} opts
 */
export function transferComplete({ to, amount, fromBalance, toBalance } = {}) {
  const lines = [
    '💸 *Transferência enviada*',
    `Valor: *${amount}* coins para *${to}*`,
    `Seu saldo: *${fromBalance}*c`,
  ];
  if (toBalance != null) lines.push(`Saldo dela(e): *${toBalance}*c`);
  return lines.join('\n');
}

/**
 * @param {{ amount: number, balance: number }} opts
 */
export function dailyClaimed({ amount, balance } = {}) {
  return [
    '🎁 *Daily resgatado*',
    `+*${amount}* coins`,
    `Saldo: *${balance}*c`,
  ].join('\n');
}

/**
 * @param {{ total: number, balance: number, details?: string }} opts
 */
export function collectComplete({ total, balance, details } = {}) {
  const lines = [
    `💵 *Coleta* — sacou *${total}*c`,
    details ? details : null,
    `Saldo: *${balance}*c`,
  ].filter(Boolean);
  return lines.join('\n');
}