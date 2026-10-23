/**
 * Insights por regras, calculados só com dados existentes.
 * Nenhuma conclusão é gerada sem base: cada regra verifica se há histórico.
 */
import { formatDateBR, formatMonthLong, monthRange, shiftMonth, type ISODate, type MonthKey } from "./dates";
import { formatBRL } from "./money";
import { percentChange, savingsRate, summarize, type Entry } from "./summary";
import { averageOf, sameDaysPreviousMonth } from "./reports";

export type InsightTone = "positive" | "negative" | "neutral" | "warning";
export interface Insight {
  id: string;
  tone: InsightTone;
  text: string;
}

export interface InsightInput {
  entries: Entry[];
  month: MonthKey;
  today: ISODate;
  categories: { id: string; name: string; kind: "income" | "expense" }[];
  goals?: { name: string; percent: number; kind: string; done: boolean }[];
  budgets?: { categoryId: string; percent: number }[];
  projection?: { firstNegative: { date: ISODate; balance: number } | null; until: ISODate } | null;
  /** despesas dos meses anteriores (mais antigo → mais recente), para médias */
  previousExpenses?: number[];
}

const pct = (v: number) => `${Math.round(Math.abs(v))}%`;
const MIN_CHANGE_PCT = 15;
const MIN_CHANGE_CENTS = 5_000; // R$ 50: ignora variações pequenas

export function buildInsights(input: InsightInput): Insight[] {
  const { entries, month, today, categories } = input;
  const out: Insight[] = [];
  const range = monthRange(month);
  const inProgress = today >= range.from && today <= range.to;
  const cut = inProgress ? { from: range.from, to: today } : range;
  const prevMonth = shiftMonth(month, -1);
  const prevRange = inProgress ? sameDaysPreviousMonth(range, today, prevMonth) : monthRange(prevMonth);
  const cur = summarize(entries, cut, "competencia");
  const prev = summarize(entries, prevRange, "competencia");
  const catName = (id: string) => categories.find((c) => c.id === id)?.name;
  const period = inProgress ? "até hoje" : `em ${formatMonthLong(month).split(" de ")[0].toLowerCase()}`;
  const comparedTo = inProgress ? "ao mesmo período do mês passado" : "ao mês anterior";

  // 1) variação por categoria (só com base nos dois períodos)
  if (prev.expense > 0 && cur.expense > 0) {
    const changes = [...cur.expenseByCategory.entries()]
      .map(([id, v]) => ({ id, v, p: prev.expenseByCategory.get(id) ?? 0 }))
      .filter((c) => c.p > 0 && c.v > 0 && catName(c.id))
      .map((c) => ({ ...c, change: percentChange(c.v, c.p)!, diff: c.v - c.p }))
      .filter((c) => Math.abs(c.change) >= MIN_CHANGE_PCT && Math.abs(c.diff) >= MIN_CHANGE_CENTS)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 2);
    for (const c of changes) {
      out.push({
        id: `cat-${c.id}`,
        tone: c.change > 0 ? "negative" : "positive",
        text: `Seus gastos com ${catName(c.id)} ${c.change > 0 ? "aumentaram" : "diminuíram"} ${pct(c.change)} ${period} em relação ${comparedTo} (${formatBRL(c.p)} → ${formatBRL(c.v)}).`,
      });
    }
  }

  // 2) taxa de poupança do mês
  const rate = savingsRate(cur);
  if (rate !== null) {
    if (cur.result >= 0) {
      out.push({
        id: "savings",
        tone: rate >= 10 ? "positive" : "neutral",
        text: `Você ${inProgress ? "está economizando" : "economizou"} ${pct(rate)} da sua receita ${period} (${formatBRL(cur.result)}).`,
      });
    } else {
      out.push({
        id: "savings",
        tone: "negative",
        text: `As despesas ${inProgress ? "estão superando" : "superaram"} as receitas ${period} em ${formatBRL(-cur.result)}.`,
      });
    }
  }

  // 3) despesa x média dos meses anteriores (precisa de 3 meses com dados)
  const prevExp = (input.previousExpenses ?? []).filter((v) => v > 0);
  if (prevExp.length >= 3 && !inProgress) {
    const avg = averageOf(prevExp.slice(-3))!;
    const full = summarize(entries, range, "competencia").expense;
    const ch = percentChange(full, avg);
    if (ch !== null && Math.abs(ch) >= 10) {
      out.push({
        id: "avg",
        tone: ch > 0 ? "warning" : "positive",
        text: `Suas despesas ${period} ficaram ${pct(ch)} ${ch > 0 ? "acima" : "abaixo"} da sua média dos 3 meses anteriores (${formatBRL(avg)}).`,
      });
    }
  }

  // 4) reservas
  for (const g of (input.goals ?? []).filter((x) => !x.done).sort((a, b) => (a.kind === "emergency" ? -1 : b.kind === "emergency" ? 1 : 0)).slice(0, 2)) {
    out.push({ id: `goal-${g.name}`, tone: "neutral", text: `Sua reserva "${g.name}" está em ${Math.floor(g.percent)}% da meta.` });
  }
  for (const g of (input.goals ?? []).filter((x) => x.done).slice(0, 1)) {
    out.push({ id: `goal-done-${g.name}`, tone: "positive", text: `Meta atingida: a reserva "${g.name}" chegou a 100%.` });
  }

  // 5) orçamentos
  const over = (input.budgets ?? []).filter((b) => b.percent >= 100);
  if (over.length) {
    out.push({
      id: "budgets-over",
      tone: "negative",
      text: `${over.length === 1 ? "Um orçamento passou" : `${over.length} orçamentos passaram`} do limite: ${over.map((b) => catName(b.categoryId)).filter(Boolean).join(", ")}.`,
    });
  }

  // 6) projeção
  if (input.projection?.firstNegative) {
    const n = input.projection.firstNegative;
    out.push({
      id: "projection",
      tone: "warning",
      text: `Pelo que está previsto, seu saldo disponível fica negativo em ${formatDateBR(n.date)} (${formatBRL(n.balance)}). Antecipe uma receita ou adie um pagamento.`,
    });
  }

  if (!out.length) {
    out.push({
      id: "no-history",
      tone: "neutral",
      text: "Ainda não há histórico suficiente para comparações. Os insights aparecem conforme você registra seus lançamentos.",
    });
  }
  return out;
}
