/**
 * "A pagar no mês": tudo que vence no mês, somando contas e faturas de cartão.
 *
 * É uma visão de pagamento (quanto sai do bolso no mês), diferente de
 * "Despesas do mês" por competência — lá a compra no cartão conta no mês em que
 * foi feita; aqui conta a FATURA no mês em que vence. Não soma os dois.
 */
import { inRange, type DateRange, type ISODate } from "./dates";

export interface PayableBill {
  amountCents: number;
  date: ISODate;
  status: "paid" | "pending" | "cancelled";
}

export interface PayableStatement {
  cardId: string;
  cardName: string;
  dueDate: ISODate;
  closingDate: ISODate;
  chargesCents: number;
  creditsCents: number;
  paymentsCents: number;
}

export interface MonthPayables {
  bills: { total: number; paid: number; remaining: number; count: number };
  cards: { cardId: string; cardName: string; dueDate: ISODate; total: number; paid: number; remaining: number; open: boolean }[];
  total: number;
  paid: number;
  remaining: number;
}

export function monthPayables(range: DateRange, today: ISODate, bills: PayableBill[], statements: PayableStatement[]): MonthPayables {
  const b = { total: 0, paid: 0, remaining: 0, count: 0 };
  for (const t of bills) {
    if (t.status === "cancelled" || !inRange(t.date, range)) continue;
    b.total += t.amountCents;
    b.count++;
    if (t.status === "paid") b.paid += t.amountCents;
    else b.remaining += t.amountCents;
  }
  const cards = statements
    .filter((s) => inRange(s.dueDate, range))
    .map((s) => {
      const total = Math.max(0, s.chargesCents - s.creditsCents);
      const paid = Math.min(total, s.paymentsCents);
      return {
        cardId: s.cardId,
        cardName: s.cardName,
        dueDate: s.dueDate,
        total,
        paid,
        remaining: total - paid,
        // fatura ainda não fechou: o valor pode subir
        open: today < s.closingDate,
      };
    })
    .filter((c) => c.total > 0)
    .sort((x, y) => x.dueDate.localeCompare(y.dueDate) || y.total - x.total);
  const total = b.total + cards.reduce((a, c) => a + c.total, 0);
  const paid = b.paid + cards.reduce((a, c) => a + c.paid, 0);
  return { bills: b, cards, total, paid, remaining: total - paid };
}
