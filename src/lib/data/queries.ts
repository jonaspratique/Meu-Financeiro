import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/supabase/server";
import { addDays, monthKeyOf, monthRange, shiftMonth, type ISODate, type MonthKey } from "@/lib/finance/dates";
import type { BalanceRow } from "@/lib/finance/overview";
import {
  mapAccount, mapAdjustment, mapBudget, mapCard, mapCardPurchase, mapCategory, mapGoal, mapInstallment, mapMovement,
  mapRule, mapStatementPayment, mapStatementTotals, mapTransaction, mapTransfer,
  type Account, type Category, type CreditCard, type StatementTotals, type Transaction, type Transfer,
} from "@/lib/types";

type Row = Record<string, unknown>;
const PAGE = 1000; // limite padrão de linhas por requisição do Supabase

/** Busca todas as páginas — nunca truncar silenciosamente dados financeiros. */
async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export const getAccounts = cache(async (): Promise<Account[]> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("accounts").select("*").order("is_default", { ascending: false }).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAccount);
});

export const getCategories = cache(async (): Promise<Category[]> => {
  const { supabase } = await requireUser();
  let { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    // primeiro acesso: cria as categorias padrão (idempotente)
    await supabase.rpc("ensure_default_categories");
    ({ data, error } = await supabase.from("categories").select("*").order("name"));
    if (error) throw new Error(error.message);
  }
  return (data ?? []).map(mapCategory);
});

export const getBalances = cache(async (asOf: ISODate): Promise<BalanceRow[]> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("account_balances", { p_as_of: asOf });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => ({
    accountId: String(r.account_id),
    balanceCents: Number(r.balance_cents),
    reservedCents: Number(r.reserved_cents),
  }));
});

/** Lançamentos relevantes para um intervalo em QUALQUER regime (data OU pagamento no intervalo). */
export const getTransactionsInRange = cache(async (from: ISODate, to: ISODate): Promise<Transaction[]> => {
  const { supabase } = await requireUser();
  const rows = await fetchAll((a, b) =>
    supabase
      .from("transactions")
      .select("*")
      .or(`and(date.gte.${from},date.lte.${to}),and(paid_at.gte.${from},paid_at.lte.${to})`)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(a, b),
  );
  return rows.map(mapTransaction);
});

export const getTransfersInRange = cache(async (from: ISODate, to: ISODate): Promise<Transfer[]> => {
  const { supabase } = await requireUser();
  const rows = await fetchAll((a, b) =>
    supabase
      .from("transfers")
      .select("*")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(a, b),
  );
  return rows.map(mapTransfer);
});

export async function getRecentTransactions(limit = 6, today?: ISODate) {
  const { supabase } = await requireUser();
  let query = supabase.from("transactions").select("*").neq("status", "cancelled");
  // previstas de recorrências futuras não são "últimas movimentações"
  if (today) query = query.lte("date", today);
  const { data, error } = await query
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTransaction);
}

/** Pendentes vencidos + a vencer até `days` dias. */
export async function getUpcoming(today: ISODate, days: number, limit = 50) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("status", "pending")
    .lte("date", addDays(today, days))
    .order("date", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTransaction);
}

export const getSavings = cache(async () => {
  const { supabase } = await requireUser();
  const [goals, movements] = await Promise.all([
    supabase.from("savings_goals").select("*").order("created_at"),
    fetchAll((a, b) => supabase.from("savings_movements").select("*").order("date").order("created_at").range(a, b)),
  ]);
  if (goals.error) throw new Error(goals.error.message);
  return { goals: (goals.data ?? []).map(mapGoal), movements: movements.map(mapMovement) };
});

export async function getAdjustments() {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("account_adjustments").select("*").order("date", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAdjustment);
}

/** Saldos em várias datas (ex.: fim de cada mês) para séries de patrimônio. */
export async function getBalanceSeries(dates: ISODate[]) {
  return Promise.all(dates.map(async (d) => ({ date: d, rows: await getBalances(d) })));
}

/** Total já estornado (não cancelado) por despesa. */
export async function getRefundTotals(expenseIds: string[]) {
  const totals: Record<string, number> = {};
  if (!expenseIds.length) return totals;
  const { supabase } = await requireUser();
  for (let i = 0; i < expenseIds.length; i += 200) {
    const { data, error } = await supabase
      .from("transactions")
      .select("refund_of_id, amount_cents")
      .eq("type", "refund")
      .neq("status", "cancelled")
      .in("refund_of_id", expenseIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) totals[r.refund_of_id] = (totals[r.refund_of_id] ?? 0) + Number(r.amount_cents);
  }
  return totals;
}

/* ================================ Fase 2 ================================ */

/**
 * Gera ocorrências previstas das recorrências (idempotente). Contas: até o fim
 * do mês seguinte; cartão: até hoje. Chamado uma vez por requisição.
 */
export const ensureRecurring = cache(async (today: ISODate) => {
  const { supabase } = await requireUser();
  const until = monthRange(shiftMonth(monthKeyOf(today), 1)).to;
  const { error } = await supabase.rpc("generate_recurring", { p_today: today, p_until: until });
  if (error) console.error("[recorrências]", error.message);
});

export const getCards = cache(async (): Promise<CreditCard[]> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("credit_cards").select("*").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapCard);
});

/** Dívida de cada cartão em uma data (parcelas lançadas − pagamentos). */
export const getCardBalances = cache(async (asOf: ISODate): Promise<Map<string, number>> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("card_balances", { p_as_of: asOf });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Row[]).map((r) => [String(r.card_id), Number(r.used_cents)]));
});

export async function getTotalCardDebt(asOf: ISODate) {
  let total = 0;
  for (const v of (await getCardBalances(asOf)).values()) total += v;
  return total;
}

export const getStatementTotals = cache(async (): Promise<StatementTotals[]> => {
  const { supabase } = await requireUser();
  const rows = await fetchAll((a, b) =>
    supabase.from("credit_card_statement_totals").select("*").order("month").range(a, b),
  );
  return rows.map(mapStatementTotals);
});

const INSTALLMENT_SELECT = "*, credit_card_purchases(description, kind, category_id, purchase_date, total_cents, installments)";

/** Parcelas com competência no intervalo (para resumos por competência). */
export const getInstallmentsInRange = cache(async (from: ISODate, to: ISODate) => {
  const { supabase } = await requireUser();
  const rows = await fetchAll((a, b) =>
    supabase
      .from("credit_card_installments")
      .select(INSTALLMENT_SELECT)
      .gte("competence_date", from)
      .lte("competence_date", to)
      .order("competence_date")
      .range(a, b),
  );
  return rows.map(mapInstallment);
});

export async function getStatementInstallments(statementId: string) {
  const { supabase } = await requireUser();
  const rows = await fetchAll((a, b) =>
    supabase.from("credit_card_installments").select(INSTALLMENT_SELECT).eq("statement_id", statementId).order("competence_date").range(a, b),
  );
  return rows.map(mapInstallment);
}

const PAYMENT_SELECT = "*, credit_card_statements(card_id)";

/** Pagamentos de fatura no intervalo (saídas de caixa). */
export const getStatementPaymentsInRange = cache(async (from: ISODate, to: ISODate) => {
  const { supabase } = await requireUser();
  const rows = await fetchAll((a, b) =>
    supabase.from("statement_payments").select(PAYMENT_SELECT).gte("date", from).lte("date", to).order("date", { ascending: false }).range(a, b),
  );
  return rows.map(mapStatementPayment);
});

export async function getStatementPayments(statementId: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("statement_payments").select(PAYMENT_SELECT).eq("statement_id", statementId).order("date");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStatementPayment);
}

/** Compras/estornos/ajustes de cartão com data de compra no intervalo. */
export const getCardPurchasesInRange = cache(async (from: ISODate, to: ISODate) => {
  const { supabase } = await requireUser();
  const rows = await fetchAll((a, b) =>
    supabase.from("credit_card_purchases").select("*").gte("purchase_date", from).lte("purchase_date", to)
      .order("purchase_date", { ascending: false }).order("created_at", { ascending: false }).range(a, b),
  );
  return rows.map(mapCardPurchase);
});

export async function getCardPurchasesByIds(ids: string[]) {
  if (!ids.length) return [];
  const { supabase } = await requireUser();
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("credit_card_purchases").select("*").in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map(mapCardPurchase));
  }
  return out;
}

/** Total já estornado por compra de cartão. */
export async function getCardRefundTotals(purchaseIds: string[]) {
  const totals: Record<string, number> = {};
  if (!purchaseIds.length) return totals;
  const { supabase } = await requireUser();
  for (let i = 0; i < purchaseIds.length; i += 200) {
    const { data, error } = await supabase
      .from("credit_card_purchases").select("refund_of_id, total_cents").eq("kind", "refund").in("refund_of_id", purchaseIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) totals[r.refund_of_id] = (totals[r.refund_of_id] ?? 0) + Number(r.total_cents);
  }
  return totals;
}

export const getRecurringRules = cache(async () => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("recurring_rules").select("*").order("start_date");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRule);
});

/** Próxima ocorrência prevista de cada recorrência (a partir de hoje). */
export async function getNextOccurrences(today: ISODate) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("transactions").select("recurring_rule_id, occurrence_date").not("recurring_rule_id", "is", null)
    .eq("status", "pending").gte("occurrence_date", today).order("occurrence_date");
  if (error) throw new Error(error.message);
  const next = new Map<string, string>();
  for (const r of data ?? []) if (!next.has(r.recurring_rule_id)) next.set(r.recurring_rule_id, r.occurrence_date);
  return next;
}

export const getBudgets = cache(async (month: MonthKey) => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("budgets").select("*").eq("month", `${month}-01`);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapBudget);
});

/** Todos os dados do usuário (exportação/backup). */
export async function getEverything() {
  const { supabase } = await requireUser();
  const tables = [
    "accounts", "categories", "transactions", "transfers", "account_adjustments", "savings_goals", "savings_movements",
    "credit_cards", "credit_card_statements", "recurring_rules", "credit_card_purchases", "credit_card_installments",
    "statement_payments", "budgets",
  ] as const;
  const out: Record<string, Row[]> = {};
  for (const t of tables) {
    out[t] = await fetchAll((a, b) => supabase.from(t).select("*").order("created_at").range(a, b));
  }
  return out;
}
