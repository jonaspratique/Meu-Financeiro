"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { todayISO } from "@/lib/finance/dates";
import { entrySchema, firstIssue, isoDate, refundSchema, type ActionResult, type EntryInput } from "@/lib/validation";
import { dbError } from "./errors";

const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

export async function saveEntry(input: EntryInput): Promise<ActionResult> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();

  const paidAt = v.status === "paid" ? (v.paidAt ?? v.date) : null;

  // não permitir NOVOS lançamentos em contas arquivadas
  const accountIds = v.kind === "transfer" ? [v.fromAccountId, v.toAccountId] : [v.accountId];
  if (!v.id) {
    const { data: accs, error } = await supabase.from("accounts").select("id, archived_at").in("id", accountIds);
    if (error) return { ok: false, error: dbError(error) };
    if ((accs ?? []).length !== new Set(accountIds).size) return { ok: false, error: "Conta não encontrada." };
    if ((accs ?? []).some((a) => a.archived_at)) return { ok: false, error: "Conta arquivada não recebe novos lançamentos." };
  }

  if (v.kind === "transfer") {
    const row = {
      from_account_id: v.fromAccountId,
      to_account_id: v.toAccountId,
      amount_cents: v.amount,
      date: v.date,
      status: v.status,
      paid_at: paidAt,
      description: v.description,
      notes: v.notes,
    };
    const { error } = v.id
      ? await supabase.from("transfers").update(row).eq("id", v.id)
      : await supabase.from("transfers").insert(row);
    if (error) return { ok: false, error: dbError(error) };
    return done(v.id ? "Transferência atualizada" : "Transferência registrada");
  }

  const row = {
    type: v.kind,
    description: v.description,
    amount_cents: v.amount,
    date: v.date,
    status: v.status,
    paid_at: paidAt,
    account_id: v.accountId,
    category_id: v.categoryId,
    payment_method: v.paymentMethod,
    notes: v.notes,
  };

  if (v.id) {
    const { data: current } = await supabase.from("transactions").select("type").eq("id", v.id).single();
    if (current?.type === "refund") return { ok: false, error: "Estornos são editados pela despesa original." };
    const { error } = await supabase.from("transactions").update(row).eq("id", v.id);
    if (error) return { ok: false, error: dbError(error) };
    return done("Lançamento atualizado");
  }
  const { error } = await supabase.from("transactions").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  return done(v.kind === "income" ? "Receita registrada" : "Despesa registrada");
}

export async function deleteEntry(kind: "transaction" | "transfer", id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const table = kind === "transfer" ? "transfers" : "transactions";
  const { error, count } = await supabase.from(table).delete({ count: "exact" }).eq("id", id);
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Esta despesa possui estornos. Exclua os estornos primeiro." };
    return { ok: false, error: dbError(error) };
  }
  if (!count) return { ok: false, error: "Lançamento não encontrado." };
  return done("Lançamento excluído");
}

export async function setEntryStatus(
  kind: "transaction" | "transfer",
  id: string,
  status: "paid" | "pending" | "cancelled",
  paidAtInput?: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  let paidAt: string | null = null;
  if (status === "paid") {
    const p = isoDate.safeParse(paidAtInput ?? todayISO());
    if (!p.success) return { ok: false, error: "Data inválida" };
    paidAt = p.data;
  }
  const table = kind === "transfer" ? "transfers" : "transactions";
  const { error } = await supabase.from(table).update({ status, paid_at: paidAt }).eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done(status === "paid" ? "Marcado como efetivado" : status === "cancelled" ? "Lançamento cancelado" : "Marcado como pendente");
}

/** Estorno/reembolso de uma despesa: devolve dinheiro na mesma conta e abate a despesa na categoria original. */
export async function createRefund(input: { refundOfId: string; amount: string; date: string; description: string }): Promise<ActionResult> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const { data: orig, error: e1 } = await supabase
    .from("transactions")
    .select("id, type, account_id, payment_method")
    .eq("id", v.refundOfId)
    .single();
  if (e1 || !orig) return { ok: false, error: "Despesa original não encontrada." };
  const { error } = await supabase.from("transactions").insert({
    type: "refund",
    refund_of_id: orig.id,
    description: v.description,
    amount_cents: v.amount,
    date: v.date,
    status: "paid",
    paid_at: v.date,
    account_id: orig.account_id,
    payment_method: orig.payment_method,
    // category_id é herdada da despesa original pelo trigger do banco
    category_id: null,
  });
  if (error) return { ok: false, error: dbError(error) };
  return done("Estorno registrado");
}
