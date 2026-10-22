import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/supabase/server";
import { addDays, type ISODate } from "@/lib/finance/dates";
import type { BalanceRow } from "@/lib/finance/overview";
import {
  mapAccount, mapAdjustment, mapCategory, mapGoal, mapMovement, mapTransaction, mapTransfer,
  type Account, type Category, type Transaction, type Transfer,
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

export async function getRecentTransactions(limit = 6) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .neq("status", "cancelled")
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

/** Todos os dados do usuário (exportação/backup). */
export async function getEverything() {
  const { supabase } = await requireUser();
  const tables = ["accounts", "categories", "transactions", "transfers", "account_adjustments", "savings_goals", "savings_movements"] as const;
  const out: Record<string, Row[]> = {};
  for (const t of tables) {
    out[t] = await fetchAll((a, b) => supabase.from(t).select("*").order("created_at").range(a, b));
  }
  return out;
}
