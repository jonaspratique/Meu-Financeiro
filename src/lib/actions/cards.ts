"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import {
  budgetSchema, cardAdjustmentSchema, cardRefundSchema, cardSchema, firstIssue, paymentSchema, type ActionResult,
} from "@/lib/validation";
import { formatBRL } from "@/lib/finance/money";
import { shiftMonth } from "@/lib/finance/dates";
import { dbError } from "./errors";

const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

/* -------------------------------- cartões -------------------------------- */
export async function saveCard(input: {
  id?: string;
  name: string;
  limit: string;
  closingDay: number | string;
  dueDay: number | string;
  color: string;
  paymentAccountId?: string;
}): Promise<ActionResult> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const row = {
    name: v.name,
    limit_cents: v.limit,
    closing_day: v.closingDay,
    due_day: v.dueDay,
    color: v.color,
    payment_account_id: v.paymentAccountId ?? null,
  };
  const { error } = v.id
    ? await supabase.from("credit_cards").update(row).eq("id", v.id)
    : await supabase.from("credit_cards").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  return done(v.id ? "Cartão atualizado. Faturas já criadas mantêm as datas originais." : "Cartão criado");
}

export async function setCardArchived(id: string, archived: boolean): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("credit_cards")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done(archived ? "Cartão arquivado" : "Cartão reativado");
}

export async function deleteCard(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("credit_cards").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { ok: false, error: "O cartão tem lançamentos ou recorrências. Arquive-o para preservar o histórico." };
    return { ok: false, error: dbError(error) };
  }
  return done("Cartão excluído");
}

/* ------------------------------- faturas -------------------------------- */
/** Pagamento total ou parcial de uma fatura. Reduz o saldo da conta; não é despesa nova. */
export async function payStatement(input: { statementId: string; accountId: string; amount: string; date: string }): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const { error } = await supabase.from("statement_payments").insert({
    statement_id: v.statementId,
    account_id: v.accountId,
    amount_cents: v.amount,
    date: v.date,
  });
  if (error) return { ok: false, error: dbError(error) };
  return done(`Pagamento de ${formatBRL(v.amount)} registrado`);
}

export async function deleteStatementPayment(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("statement_payments").delete().eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done("Pagamento removido");
}

/* -------------------------- compras no cartão --------------------------- */
export async function deleteCardPurchase(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error, count } = await supabase.from("credit_card_purchases").delete({ count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  if (!count) return { ok: false, error: "Lançamento não encontrado." };
  return done("Lançamento do cartão excluído (parcelas e estornos ligados também)");
}

/** Estorno de uma compra do cartão: vira crédito na fatura da data do estorno. */
export async function refundCardPurchase(input: { purchaseId: string; amount: string; date: string }): Promise<ActionResult> {
  const parsed = cardRefundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const { data: orig, error: e1 } = await supabase
    .from("credit_card_purchases")
    .select("id, card_id, category_id, description")
    .eq("id", v.purchaseId)
    .single();
  if (e1 || !orig) return { ok: false, error: "Compra não encontrada." };
  const { error } = await supabase.rpc("save_card_purchase", {
    p_id: null,
    p_card_id: orig.card_id,
    p_kind: "refund",
    p_description: `Estorno: ${orig.description}`.slice(0, 120),
    p_total_cents: v.amount,
    p_purchase_date: v.date,
    p_installments: 1,
    p_category_id: orig.category_id,
    p_refund_of_id: orig.id,
  });
  if (error) return { ok: false, error: dbError(error) };
  return done("Estorno lançado como crédito na fatura");
}

/** Tarifa/juros (soma na fatura) ou crédito/ajuste a favor (subtrai). */
export async function saveCardAdjustment(input: {
  cardId: string;
  kind: "fee" | "credit";
  description: string;
  amount: string;
  date: string;
  categoryId: string;
}): Promise<ActionResult> {
  const parsed = cardAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_card_purchase", {
    p_id: null,
    p_card_id: v.cardId,
    p_kind: v.kind,
    p_description: v.description,
    p_total_cents: v.amount,
    p_purchase_date: v.date,
    p_installments: 1,
    p_category_id: v.categoryId,
  });
  if (error) return { ok: false, error: dbError(error) };
  return done(v.kind === "fee" ? "Tarifa lançada na fatura" : "Crédito lançado na fatura");
}

/* ------------------------------ orçamentos ------------------------------ */
export async function saveBudget(input: { month: string; categoryId: string; amount: string }): Promise<ActionResult> {
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("budgets")
    .upsert({ month: `${v.month}-01`, category_id: v.categoryId, amount_cents: v.amount }, { onConflict: "user_id,month,category_id" });
  if (error) return { ok: false, error: dbError(error) };
  return done("Orçamento salvo");
}

export async function deleteBudget(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("budgets").delete().eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done("Orçamento removido");
}

export async function copyBudgetsToNextMonth(month: string): Promise<ActionResult> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: "Mês inválido" };
  const { supabase } = await requireUser();
  const next = shiftMonth(month, 1);
  const { data, error } = await supabase.rpc("copy_budgets", { p_from: `${month}-01`, p_to: `${next}-01` });
  if (error) return { ok: false, error: dbError(error) };
  const n = Number(data ?? 0);
  return done(n ? `${n} ${n === 1 ? "orçamento copiado" : "orçamentos copiados"} para o mês seguinte` : "O mês seguinte já tinha esses orçamentos");
}
