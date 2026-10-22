/**
 * Fluxos de um período (receitas, despesas, resultado), nos dois regimes:
 *
 *  - COMPETÊNCIA: o que pertence ao período, pela data do lançamento (`date`),
 *    incluindo pendentes. Responde "quanto eu gastei em outubro?".
 *  - CAIXA: o que efetivamente entrou/saiu no período, pela data de pagamento
 *    (`paidAt`), somente efetivados. Responde "quanto dinheiro saiu em outubro?".
 *
 * Regras invariantes:
 *  - Cancelados nunca contam.
 *  - Transferências internas NÃO passam por aqui (não são receita nem despesa).
 *  - Estornos (refund) abatem a despesa da categoria da despesa original.
 *  - Ajustes de conciliação alteram saldo, mas não são receita nem despesa.
 */
import { inRange, type DateRange, type ISODate, type MonthKey, monthRange } from "./dates";

export type Regime = "competencia" | "caixa";
export type EntryType = "income" | "expense" | "refund";
export type EntryStatus = "pending" | "paid" | "cancelled";

export interface Entry {
  type: EntryType;
  amountCents: number;
  date: ISODate;
  status: EntryStatus;
  paidAt: ISODate | null;
  categoryId: string | null;
}

export interface PeriodSummary {
  income: number;
  /** despesas brutas menos estornos */
  expense: number;
  refunds: number;
  result: number;
  /** Despesa líquida por categoria (pode ficar 0 se totalmente estornada). */
  expenseByCategory: Map<string, number>;
  incomeByCategory: Map<string, number>;
  /** Só faz sentido em competência: quanto do período ainda está pendente. */
  pendingIncome: number;
  pendingExpense: number;
}

export function isRegime(v: unknown): v is Regime {
  return v === "competencia" || v === "caixa";
}

/** O lançamento conta no período/regime? */
export function countsIn(entry: Entry, range: DateRange, regime: Regime): boolean {
  if (entry.status === "cancelled") return false;
  if (regime === "caixa") return entry.status === "paid" && inRange(entry.paidAt, range);
  return inRange(entry.date, range);
}

export function summarize(entries: Iterable<Entry>, range: DateRange, regime: Regime): PeriodSummary {
  let income = 0;
  let grossExpense = 0;
  let refunds = 0;
  let pendingIncome = 0;
  let pendingExpense = 0;
  const expenseByCategory = new Map<string, number>();
  const incomeByCategory = new Map<string, number>();
  const add = (m: Map<string, number>, k: string | null, v: number) => {
    const key = k ?? "sem-categoria";
    m.set(key, (m.get(key) ?? 0) + v);
  };

  for (const e of entries) {
    if (!countsIn(e, range, regime)) continue;
    switch (e.type) {
      case "income":
        income += e.amountCents;
        add(incomeByCategory, e.categoryId, e.amountCents);
        if (e.status === "pending") pendingIncome += e.amountCents;
        break;
      case "expense":
        grossExpense += e.amountCents;
        add(expenseByCategory, e.categoryId, e.amountCents);
        if (e.status === "pending") pendingExpense += e.amountCents;
        break;
      case "refund":
        refunds += e.amountCents;
        add(expenseByCategory, e.categoryId, -e.amountCents);
        if (e.status === "pending") pendingExpense -= e.amountCents;
        break;
    }
  }

  const expense = grossExpense - refunds;
  return {
    income,
    expense,
    refunds,
    result: income - expense,
    expenseByCategory,
    incomeByCategory,
    pendingIncome,
    pendingExpense,
  };
}

export interface MonthPoint {
  month: MonthKey;
  income: number;
  expense: number;
  result: number;
}

export function monthlySeries(entries: Entry[], months: MonthKey[], regime: Regime): MonthPoint[] {
  return months.map((month) => {
    const s = summarize(entries, monthRange(month), regime);
    return { month, income: s.income, expense: s.expense, result: s.result };
  });
}

/** Variação percentual; null quando não há base de comparação. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Taxa de poupança do período (resultado / receita). null sem receita. */
export function savingsRate(s: Pick<PeriodSummary, "income" | "result">): number | null {
  if (s.income <= 0) return null;
  return (s.result / s.income) * 100;
}

/** Ordena categorias por gasto, descartando zeradas/negativas. */
export function topCategories(byCategory: Map<string, number>, limit = Infinity) {
  return [...byCategory.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([categoryId, amount]) => ({ categoryId, amount }));
}
