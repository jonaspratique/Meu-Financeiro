import "server-only";
import { lastMonths, monthKeyOf, monthRange, shiftMonth, type ISODate, type MonthKey } from "@/lib/finance/dates";
import { buildInsights } from "@/lib/finance/insights";
import { computeOverview } from "@/lib/finance/overview";
import { projectBalance, type ProjectionItem } from "@/lib/finance/reports";
import { goalProgress } from "@/lib/finance/savings";
import { monthlySeries } from "@/lib/finance/summary";
import { getEntriesInRange } from "./entries";
import { getBudgetUsage, getDueStatements } from "./planning";
import { getAccounts, getBalances, getCategories, getSavings, getUpcoming } from "./queries";

/** Horizonte da projeção = até onde as recorrências já estão previstas (fim do mês seguinte). */
export const projectionUntil = (today: ISODate) => monthRange(shiftMonth(monthKeyOf(today), 1)).to;

/** Saldo disponível previsto até o fim do mês seguinte. */
export async function getProjection(today: ISODate) {
  const until = projectionUntil(today);
  const days = Math.round((Date.parse(until) - Date.parse(today)) / 86_400_000);
  const [accounts, balances, pending, statements] = await Promise.all([
    getAccounts(),
    getBalances(today),
    getUpcoming(today, days, 2000),
    getDueStatements(today, days),
  ]);
  const operational = new Set(accounts.filter((a) => a.isOperational && !a.archived).map((a) => a.id));
  const start = computeOverview(accounts, balances).available;
  const items: ProjectionItem[] = [
    ...pending
      .filter((t) => operational.has(t.accountId) && t.type !== "refund")
      .map((t) => ({ date: t.date, amountCents: t.type === "income" ? t.amountCents : -t.amountCents, label: t.description })),
    ...statements.map((s) => ({ date: s.totals.dueDate, amountCents: -s.remaining, label: `Fatura ${s.card.name}` })),
  ];
  return { ...projectBalance(start, items, today, until), until, start, items };
}

export async function getInsights(month: MonthKey, today: ISODate) {
  const months = lastMonths(month, 4);
  const [entries, categories, savings, budgets] = await Promise.all([
    getEntriesInRange(monthRange(months[0]).from, monthRange(month).to),
    getCategories(),
    getSavings(),
    getBudgetUsage(month),
  ]);
  const isCurrent = month === monthKeyOf(today);
  const projection = isCurrent ? await getProjection(today) : null;
  const previousExpenses = monthlySeries(entries, months.slice(0, 3), "competencia").map((p) => p.expense);
  return buildInsights({
    entries,
    month,
    today,
    categories,
    goals: savings.goals
      .filter((g) => !g.archived)
      .map((g) => {
        const p = goalProgress(g, savings.movements, today);
        return { name: g.name, percent: p.percent, kind: g.kind, done: p.done };
      }),
    budgets: budgets.map((b) => ({ categoryId: b.budget.categoryId, percent: b.status.percent })),
    projection: projection ? { firstNegative: projection.firstNegative, until: projection.until } : null,
    previousExpenses,
  });
}
