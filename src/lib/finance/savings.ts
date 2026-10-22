import { monthDiff, monthKeyOf, type ISODate, type MonthKey } from "./dates";

export interface SavingsMovementLike {
  goalId: string;
  kind: "deposit" | "withdrawal";
  amountCents: number;
  date: ISODate;
}

export interface GoalLike {
  id: string;
  targetCents: number;
  targetDate: ISODate | null;
}

export interface GoalProgress {
  saved: number;
  remaining: number;
  /** 0–100 (pode passar de 100 se a meta for superada) */
  percent: number;
  /** Aporte mensal sugerido para chegar à meta no prazo. null = sem prazo. */
  suggestedMonthly: number | null;
  monthsLeft: number | null;
  overdue: boolean;
  done: boolean;
}

export function signed(m: Pick<SavingsMovementLike, "kind" | "amountCents">): number {
  return m.kind === "deposit" ? m.amountCents : -m.amountCents;
}

export function goalBalance(goalId: string, movements: SavingsMovementLike[], asOf?: ISODate): number {
  let total = 0;
  for (const m of movements) {
    if (m.goalId !== goalId) continue;
    if (asOf && m.date > asOf) continue;
    total += signed(m);
  }
  return total;
}

/**
 * Aporte sugerido = valor restante ÷ meses restantes, contando o mês atual
 * e o mês do prazo. Arredonda para cima (centavo) para não ficar abaixo da meta.
 */
export function goalProgress(goal: GoalLike, movements: SavingsMovementLike[], today: ISODate): GoalProgress {
  const saved = goalBalance(goal.id, movements);
  const remaining = Math.max(goal.targetCents - saved, 0);
  const percent = goal.targetCents > 0 ? (saved / goal.targetCents) * 100 : 0;
  const done = remaining === 0;

  let monthsLeft: number | null = null;
  let suggestedMonthly: number | null = null;
  let overdue = false;

  if (goal.targetDate) {
    const diff = monthDiff(monthKeyOf(today), monthKeyOf(goal.targetDate)) + 1;
    overdue = goal.targetDate < today && !done;
    monthsLeft = Math.max(diff, 0);
    suggestedMonthly = done ? 0 : Math.ceil(remaining / Math.max(diff, 1));
  }

  return { saved, remaining, percent, suggestedMonthly, monthsLeft, overdue, done };
}

/** Total reservado ao fim de cada mês (para o gráfico de evolução). */
export function reservesSeries(movements: SavingsMovementLike[], months: MonthKey[]) {
  const sorted = [...movements].sort((a, b) => (a.date < b.date ? -1 : 1));
  return months.map((month) => {
    const end = `${month}-31`; // comparação lexicográfica cobre qualquer fim de mês
    let total = 0;
    for (const m of sorted) {
      if (m.date > end) break;
      total += signed(m);
    }
    return { month, total };
  });
}
