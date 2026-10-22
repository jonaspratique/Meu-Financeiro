"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { ACCOUNT_TYPE_ICON } from "@/lib/types";
import { accountSchema, firstIssue, reconcileSchema, type AccountInput, type ActionResult } from "@/lib/validation";
import { formatBRL } from "@/lib/finance/money";
import { dbError } from "./errors";

const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

export async function saveAccount(input: AccountInput): Promise<ActionResult> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();

  if (v.isDefault) {
    const { error } = await supabase.from("accounts").update({ is_default: false }).eq("is_default", true);
    if (error) return { ok: false, error: dbError(error) };
  }

  const row = {
    name: v.name,
    type: v.type,
    is_operational: v.isOperational,
    initial_balance_cents: v.initialBalance,
    initial_balance_date: v.initialBalanceDate,
    color: v.color,
    icon: ACCOUNT_TYPE_ICON[v.type],
    is_default: v.isDefault,
  };
  const { error } = v.id
    ? await supabase.from("accounts").update(row).eq("id", v.id)
    : await supabase.from("accounts").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  return done(v.id ? "Conta atualizada" : "Conta criada");
}

export async function setAccountArchived(id: string, archived: boolean): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null, ...(archived ? { is_default: false } : {}) })
    .eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done(archived ? "Conta arquivada" : "Conta reativada");
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("accounts").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "A conta possui movimentações. Arquive-a para preservar o histórico." };
    }
    return { ok: false, error: dbError(error) };
  }
  return done("Conta excluída");
}

/**
 * Conciliação: o usuário informa o saldo real do banco numa data; o sistema
 * calcula a diferença para o saldo registrado e grava um AJUSTE com
 * justificativa (histórico auditável). Não é receita nem despesa.
 */
export async function reconcileAccount(input: {
  accountId: string;
  date: string;
  reportedBalance: string;
  reason: string;
}): Promise<ActionResult> {
  const parsed = reconcileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();

  const { data, error } = await supabase.rpc("account_balances", { p_as_of: v.date });
  if (error) return { ok: false, error: dbError(error) };
  const row = ((data ?? []) as { account_id: string; balance_cents: number }[]).find((r) => r.account_id === v.accountId);
  if (!row) return { ok: false, error: "A data é anterior ao saldo inicial da conta." };
  const system = Number(row.balance_cents);
  const diff = v.reportedBalance - system;
  if (diff === 0) return { ok: true, message: "O saldo já confere. Nenhum ajuste necessário." };

  const { error: e2 } = await supabase.from("account_adjustments").insert({
    account_id: v.accountId,
    date: v.date,
    amount_cents: diff,
    reason: v.reason,
    system_balance_cents: system,
    reported_balance_cents: v.reportedBalance,
  });
  if (e2) return { ok: false, error: dbError(e2) };
  return done(`Ajuste de ${formatBRL(diff)} registrado`);
}

export async function deleteAdjustment(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("account_adjustments").delete().eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done("Ajuste removido");
}
