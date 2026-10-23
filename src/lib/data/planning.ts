import "server-only";
import { addDays, monthRange, type ISODate, type MonthKey } from "@/lib/finance/dates";
import { budgetStatus, type BudgetStatus } from "@/lib/finance/budgets";
import { statementBalance } from "@/lib/finance/cards";
import { summarize } from "@/lib/finance/summary";
import type { Budget, CreditCard, StatementTotals } from "@/lib/types";
import { getEntriesInRange } from "./entries";
import { getBudgets, getCards, getStatementTotals } from "./queries";

export interface BudgetUsage {
  budget: Budget;
  status: BudgetStatus;
}

/** Consumo de cada orçamento do mês = despesa líquida da categoria por competência (conta + cartão). */
export async function getBudgetUsage(month: MonthKey): Promise<BudgetUsage[]> {
  const range = monthRange(month);
  const [budgets, entries] = await Promise.all([getBudgets(month), getEntriesInRange(range.from, range.to)]);
  if (!budgets.length) return [];
  const s = summarize(entries, range, "competencia");
  return budgets
    .map((b) => ({ budget: b, status: budgetStatus(b.amountCents, s.expenseByCategory.get(b.categoryId) ?? 0) }))
    .sort((a, b) => b.status.percent - a.status.percent);
}

export interface DueStatement {
  totals: StatementTotals;
  card: CreditCard;
  remaining: number;
  overdue: boolean;
}

/** Faturas com saldo a pagar vencidas ou que vencem até `days` dias. */
export async function getDueStatements(today: ISODate, days: number): Promise<DueStatement[]> {
  const [totals, cards] = await Promise.all([getStatementTotals(), getCards()]);
  const limit = addDays(today, days);
  const byId = new Map(cards.map((c) => [c.id, c]));
  return totals
    .filter((t) => t.closingDate <= limit && t.dueDate <= limit && statementBalance(t) > 0 && byId.has(t.cardId))
    .map((t) => ({ totals: t, card: byId.get(t.cardId)!, remaining: statementBalance(t), overdue: t.dueDate < today }))
    .sort((a, b) => (a.totals.dueDate < b.totals.dueDate ? -1 : 1));
}
