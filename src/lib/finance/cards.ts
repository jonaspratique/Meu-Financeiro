/**
 * Regras de cartão de crédito — espelho das funções SQL
 * (card_statement_month, card_statement_dates, save_card_purchase).
 * O banco é a fonte da verdade; aqui servem para prévias na tela e são
 * testadas contra os mesmos casos dos testes de banco.
 */
import { addDays, daysInMonth, monthKeyOf, shiftMonth, type ISODate, type MonthKey } from "./dates";

const pad = (n: number) => String(n).padStart(2, "0");
const clampDay = (key: MonthKey, day: number) =>
  `${key}-${pad(Math.min(day, daysInMonth(Number(key.slice(0, 4)), Number(key.slice(5, 7)))))}`;

/** Mês da fatura de uma compra: no dia do fechamento ou depois → fatura seguinte. */
export function statementMonth(purchaseDate: ISODate, closingDay: number): MonthKey {
  const key = monthKeyOf(purchaseDate);
  return purchaseDate < clampDay(key, closingDay) ? key : shiftMonth(key, 1);
}

export function statementDates(month: MonthKey, closingDay: number, dueDay: number) {
  const closing = clampDay(month, closingDay);
  const dueMonth = dueDay > closingDay ? month : shiftMonth(month, 1);
  return { closing, due: clampDay(dueMonth, dueDay) };
}

/** Divide o total em N parcelas inteiras; a diferença de centavos vai na 1ª. */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (!Number.isInteger(totalCents) || !Number.isInteger(n) || n < 1 || totalCents < n) {
    throw new Error("Parcelamento inválido");
  }
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rest : 0));
}

/** Soma k meses a uma data, ajustando para o último dia quando o mês é mais curto. */
export function addMonthsClamped(date: ISODate, k: number): ISODate {
  const target = shiftMonth(monthKeyOf(date), k);
  return clampDay(target, Number(date.slice(8, 10)));
}

export interface InstallmentPreview {
  number: number;
  amount: number;
  competence: ISODate;
  month: MonthKey;
  due: ISODate;
}

export function previewInstallments(
  totalCents: number,
  n: number,
  purchaseDate: ISODate,
  card: { closingDay: number; dueDay: number },
): InstallmentPreview[] {
  const first = statementMonth(purchaseDate, card.closingDay);
  return splitInstallments(totalCents, n).map((amount, i) => {
    const month = shiftMonth(first, i);
    return {
      number: i + 1,
      amount,
      competence: addMonthsClamped(purchaseDate, i),
      month,
      due: statementDates(month, card.closingDay, card.dueDay).due,
    };
  });
}

export type StatementState = "open" | "closed" | "overdue" | "paid" | "credit" | "empty";

export interface StatementTotalsLike {
  closingDate: ISODate;
  dueDate: ISODate;
  chargesCents: number;
  creditsCents: number;
  paymentsCents: number;
}

/** Saldo da fatura: positivo = a pagar; negativo = crédito a favor. */
export function statementBalance(t: StatementTotalsLike): number {
  return t.chargesCents - t.creditsCents - t.paymentsCents;
}

export function statementState(t: StatementTotalsLike, today: ISODate): StatementState {
  const bal = statementBalance(t);
  if (t.chargesCents === 0 && t.creditsCents === 0 && t.paymentsCents === 0) return "empty";
  if (today < t.closingDate) return "open";
  if (bal < 0) return "credit";
  if (bal === 0) return "paid";
  return today > t.dueDate ? "overdue" : "closed";
}

export const STATEMENT_STATE_LABEL: Record<StatementState, string> = {
  open: "Aberta",
  closed: "Fechada",
  overdue: "Vencida",
  paid: "Paga",
  credit: "Crédito a favor",
  empty: "Sem lançamentos",
};

/** Fatura "atual": a primeira ainda aberta (fecha hoje ou depois). */
export function currentStatementMonth(today: ISODate, closingDay: number): MonthKey {
  return statementMonth(today, closingDay);
}

/** Melhor dia de compra = dia do fechamento (entra na fatura seguinte). */
export function bestPurchaseDay(closingDay: number) {
  return closingDay;
}

export function daysUntil(from: ISODate, to: ISODate) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export { addDays };
