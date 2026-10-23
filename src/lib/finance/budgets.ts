/** Orçamento mensal por categoria: avisos em 80% e 100%. */
export type BudgetLevel = "ok" | "warning" | "over";

export interface BudgetStatus {
  limit: number;
  spent: number;
  available: number;
  /** 0–∞ (pode passar de 100) */
  percent: number;
  level: BudgetLevel;
}

export const WARNING_AT = 80;
export const OVER_AT = 100;

export function budgetStatus(limitCents: number, spentCents: number): BudgetStatus {
  const spent = Math.max(spentCents, 0); // estornos maiores que os gastos não geram "sobra" extra
  const percent = limitCents > 0 ? (spent / limitCents) * 100 : 0;
  const level: BudgetLevel = percent >= OVER_AT ? "over" : percent >= WARNING_AT ? "warning" : "ok";
  return { limit: limitCents, spent, available: limitCents - spent, percent, level };
}
