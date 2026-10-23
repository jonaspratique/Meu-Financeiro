import "server-only";
import type { ISODate } from "@/lib/finance/dates";
import { installmentEntry, statementPaymentEntry, type Entry } from "@/lib/finance/summary";
import { getInstallmentsInRange, getStatementPaymentsInRange, getTransactionsInRange } from "./queries";

/**
 * Todos os fluxos do intervalo, prontos para `summarize`:
 *  - lançamentos de conta (os dois regimes);
 *  - parcelas do cartão (só competência);
 *  - pagamentos de fatura (só caixa).
 */
export async function getEntriesInRange(from: ISODate, to: ISODate): Promise<Entry[]> {
  const [txns, installments, payments] = await Promise.all([
    getTransactionsInRange(from, to),
    getInstallmentsInRange(from, to),
    getStatementPaymentsInRange(from, to),
  ]);
  return [
    ...txns,
    ...installments
      .filter((i) => i.purchase)
      .map((i) => installmentEntry({ amountCents: i.amountCents, competenceDate: i.competenceDate, categoryId: i.purchase!.categoryId })),
    ...payments.map(statementPaymentEntry),
  ];
}
