/**
 * Cálculos dos relatórios (puros e testáveis). Todos por competência, exceto
 * quando o regime é passado explicitamente.
 */
import { addDays, monthRange, type DateRange, type ISODate, type MonthKey } from "./dates";
import { CARD_PAYMENT_CATEGORY, summarize, type Entry, type Regime } from "./summary";

/** Despesa líquida de cada categoria em cada mês. */
export function categoryByMonth(entries: Entry[], months: MonthKey[], regime: Regime = "competencia") {
  const table = new Map<string, number[]>();
  months.forEach((m, i) => {
    const s = summarize(entries, monthRange(m), regime);
    for (const [cat, v] of s.expenseByCategory) {
      if (!table.has(cat)) table.set(cat, Array(months.length).fill(0));
      table.get(cat)![i] = v;
    }
  });
  return table;
}

/** Fixas × variáveis por mês, a partir da marcação "fixa" da categoria. */
export function fixedVsVariable(entries: Entry[], months: MonthKey[], fixedIds: Set<string>) {
  return months.map((month) => {
    const s = summarize(entries, monthRange(month), "competencia");
    let fixed = 0;
    let variable = 0;
    for (const [cat, v] of s.expenseByCategory) {
      if (cat === CARD_PAYMENT_CATEGORY) continue;
      if (fixedIds.has(cat)) fixed += v;
      else variable += v;
    }
    return { month, fixed, variable };
  });
}

/** Média mensal considerando só meses com algum movimento (não "inventa" meses vazios). */
export function averageOf(values: number[]) {
  const withData = values.filter((v) => v !== 0);
  return withData.length ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : null;
}

/** Mesmo intervalo de dias no mês anterior (para comparar o mês em andamento de forma justa). */
export function sameDaysPreviousMonth(range: DateRange, upTo: ISODate, prevMonth: MonthKey): DateRange {
  const prev = monthRange(prevMonth);
  const day = Math.min(Number(upTo.slice(8, 10)), Number(prev.to.slice(8, 10)));
  return { from: prev.from, to: `${prevMonth}-${String(day).padStart(2, "0")}` };
}

/* ----------------------------- projeção de saldo ----------------------------- */
export interface ProjectionItem {
  date: ISODate;
  /** + entra, − sai */
  amountCents: number;
  label: string;
}

export interface ProjectionPoint {
  date: ISODate;
  balance: number;
}

/**
 * Saldo disponível previsto dia a dia: parte do disponível de hoje e aplica
 * contas a pagar/receber e faturas em aberto. Itens vencidos entram hoje.
 */
export function projectBalance(startCents: number, items: ProjectionItem[], today: ISODate, until: ISODate) {
  const byDay = new Map<ISODate, number>();
  for (const it of items) {
    const d = it.date < today ? today : it.date;
    if (d > until) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + it.amountCents);
  }
  const points: ProjectionPoint[] = [];
  let bal = startCents;
  let min = { date: today, balance: startCents };
  for (let d = today; d <= until; d = addDays(d, 1)) {
    bal += byDay.get(d) ?? 0;
    points.push({ date: d, balance: bal });
    if (bal < min.balance) min = { date: d, balance: bal };
  }
  return { points, end: bal, min, firstNegative: points.find((p) => p.balance < 0) ?? null };
}
