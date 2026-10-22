/**
 * Indicadores de "estoque" (fotografia em uma data), sem dupla contagem.
 *
 *  saldo da conta       = calculado no banco (função account_balances)
 *  reservado na conta   = parte do saldo etiquetada para reservas
 *  saldo disponível     = Σ contas operacionais (saldo − reservado)
 *  reservas             = Σ reservado (em qualquer conta)
 *  patrimônio líquido   = Σ saldo de TODAS as contas − dívidas
 *
 * As reservas já estão DENTRO do saldo das contas; por isso o patrimônio
 * soma apenas os saldos e nunca "saldos + reservas".
 * Limite de cartão não é dinheiro e nunca entra aqui.
 */

export interface AccountLike {
  id: string;
  isOperational: boolean;
  archived?: boolean;
}

export interface BalanceRow {
  accountId: string;
  balanceCents: number;
  reservedCents: number;
}

export interface Overview {
  totalBalance: number;
  available: number;
  reserved: number;
  debts: number;
  netWorth: number;
  /** Contas cujo valor reservado ficou maior que o saldo (gastou dinheiro reservado). */
  overAllocatedAccountIds: string[];
}

export function computeOverview(accounts: AccountLike[], balances: BalanceRow[], debts = 0): Overview {
  const byId = new Map(balances.map((b) => [b.accountId, b]));
  let totalBalance = 0;
  let available = 0;
  let reserved = 0;
  const overAllocatedAccountIds: string[] = [];

  for (const acc of accounts) {
    const b = byId.get(acc.id);
    if (!b) continue; // conta ainda não iniciada na data de referência
    totalBalance += b.balanceCents;
    reserved += b.reservedCents;
    if (acc.isOperational) available += b.balanceCents - b.reservedCents;
    if (b.reservedCents > 0 && b.reservedCents > b.balanceCents) overAllocatedAccountIds.push(acc.id);
  }

  return {
    totalBalance,
    available,
    reserved,
    debts,
    netWorth: totalBalance - debts,
    overAllocatedAccountIds,
  };
}
