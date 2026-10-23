"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { addDays, monthKeyOf, monthRange, shiftMonth, todayISO } from "@/lib/finance/dates";
import {
  entrySchema, firstIssue, isoDate, parseRepeat, refundSchema, type ActionResult, type EntryInput,
} from "@/lib/validation";
import { dbError } from "./errors";

const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** Horizonte de geração das recorrências: fim do mês seguinte (ou a data pedida, se maior). */
function generationUntil(atLeast?: string) {
  const until = monthRange(shiftMonth(monthKeyOf(todayISO()), 1)).to;
  return atLeast && atLeast > until ? atLeast : until;
}

async function generate(supabase: Supabase, atLeast?: string) {
  const { error } = await supabase.rpc("generate_recurring", { p_today: todayISO(), p_until: generationUntil(atLeast) });
  return error;
}

export async function saveEntry(input: EntryInput): Promise<ActionResult> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();

  const paidAt = v.status === "paid" ? (v.paidAt ?? v.date) : null;

  /* ------------------------------ transferência ------------------------------ */
  if (v.kind === "transfer") {
    if (!v.id) {
      const ids = [v.fromAccountId, v.toAccountId];
      const { data: accs, error } = await supabase.from("accounts").select("id, archived_at").in("id", ids);
      if (error) return { ok: false, error: dbError(error) };
      if ((accs ?? []).length !== 2) return { ok: false, error: "Conta não encontrada." };
      if ((accs ?? []).some((a) => a.archived_at)) return { ok: false, error: "Conta arquivada não recebe novos lançamentos." };
    }
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

  /* --------------------------- receita / despesa --------------------------- */
  const cardId = v.accountId.startsWith("card:") ? v.accountId.slice(5) : null;
  const accountId = cardId ? null : v.accountId;
  if (cardId && v.kind !== "expense") return { ok: false, error: "Receitas não podem ser lançadas no cartão." };
  const repeat = parseRepeat(v.repeat);

  // destino ativo (só para novos lançamentos)
  if (!v.id) {
    const table = cardId ? "credit_cards" : "accounts";
    const { data: dest, error } = await supabase.from(table).select("id, archived_at").eq("id", cardId ?? accountId!).maybeSingle();
    if (error) return { ok: false, error: dbError(error) };
    if (!dest) return { ok: false, error: cardId ? "Cartão não encontrado." : "Conta não encontrada." };
    if (dest.archived_at) return { ok: false, error: `${cardId ? "Cartão arquivado" : "Conta arquivada"} não recebe novos lançamentos.` };
  }

  /* ---- editar "esta e as próximas" de uma recorrência ---- */
  if (v.id && v.scope === "series" && v.recurringRuleId && v.occurrenceDate) {
    const { data: rule, error: re } = await supabase.from("recurring_rules").select("*").eq("id", v.recurringRuleId).single();
    if (re || !rule) return { ok: false, error: "Recorrência não encontrada." };
    if (!repeat) {
      // "Não repete" na edição da série = encerrar a série depois desta ocorrência
      const { error } = await supabase.rpc("end_recurring_rule", { p_rule_id: rule.id, p_from: addDays(v.occurrenceDate, 1) });
      if (error) return { ok: false, error: dbError(error) };
      return saveEntry({ ...(input as Extract<EntryInput, { kind: "income" | "expense" }>), scope: "one", repeat: "none" });
    }
    const { data: newRuleId, error } = await supabase.rpc("split_recurring_rule", {
      p_rule_id: rule.id,
      p_from: v.occurrenceDate,
      p_new_start: v.date,
      p_description: v.description,
      p_amount_cents: v.amount,
      p_category_id: v.categoryId,
      p_account_id: accountId,
      p_card_id: cardId,
      p_payment_method: v.paymentMethod,
      p_frequency: repeat.frequency,
      p_interval: repeat.interval,
      p_end_date: v.repeatUntil ?? null,
      p_notes: v.notes,
      p_transaction_id: v.source === "transaction" ? v.id : null,
      p_purchase_id: v.source === "card" ? v.id : null,
    });
    if (error) return { ok: false, error: dbError(error) };
    if (v.source === "transaction") {
      const { error: e2 } = await supabase.from("transactions").update({ status: v.status, paid_at: paidAt }).eq("id", v.id);
      if (e2) return { ok: false, error: dbError(e2) };
    }
    const ge = await generate(supabase, v.date);
    if (ge) return { ok: false, error: dbError(ge) };
    void newRuleId;
    return done("Esta e as próximas ocorrências foram atualizadas");
  }

  /* ---- editar um lançamento de cartão ---- */
  if (v.id && v.source === "card") {
    if (!cardId) return { ok: false, error: "Para tirar do cartão, exclua a compra e lance de novo na conta." };
    const { data: cur, error: ce } = await supabase.from("credit_card_purchases").select("kind").eq("id", v.id).single();
    if (ce || !cur) return { ok: false, error: "Compra não encontrada." };
    const { error } = await supabase.rpc("save_card_purchase", {
      p_id: v.id,
      p_card_id: cardId,
      p_kind: cur.kind,
      p_description: v.description,
      p_total_cents: v.amount,
      p_purchase_date: v.date,
      p_installments: cur.kind === "purchase" ? v.installments : 1,
      p_category_id: v.categoryId,
      p_notes: v.notes,
    });
    if (error) return { ok: false, error: dbError(error) };
    return done("Compra atualizada");
  }

  /* ---- editar um lançamento de conta (só este) ---- */
  if (v.id) {
    if (cardId) return { ok: false, error: "Para passar para o cartão, exclua e lance de novo no cartão." };
    const { data: current } = await supabase.from("transactions").select("type, recurring_rule_id").eq("id", v.id).single();
    if (current?.type === "refund") return { ok: false, error: "Estornos são editados pela despesa original." };
    const { error } = await supabase
      .from("transactions")
      .update({
        type: v.kind,
        description: v.description,
        amount_cents: v.amount,
        date: v.date,
        status: v.status,
        paid_at: paidAt,
        account_id: accountId,
        category_id: v.categoryId,
        payment_method: v.paymentMethod,
        notes: v.notes,
        // editada individualmente: edições futuras da série não a sobrescrevem
        ...(current?.recurring_rule_id ? { recurrence_detached: true } : {}),
      })
      .eq("id", v.id);
    if (error) return { ok: false, error: dbError(error) };
    return done("Lançamento atualizado");
  }

  /* ---- novo lançamento que se repete ---- */
  if (repeat) {
    const { data: rule, error } = await supabase
      .from("recurring_rules")
      .insert({
        type: v.kind,
        description: v.description,
        amount_cents: v.amount,
        category_id: v.categoryId,
        account_id: accountId,
        card_id: cardId,
        payment_method: v.paymentMethod,
        frequency: repeat.frequency,
        interval_count: repeat.interval,
        start_date: v.date,
        end_date: v.repeatUntil ?? null,
        notes: v.notes,
      })
      .select("id")
      .single();
    if (error || !rule) return { ok: false, error: dbError(error) };
    const ge = await generate(supabase, v.date);
    if (ge) return { ok: false, error: dbError(ge) };
    if (!cardId && v.status === "paid") {
      // a 1ª ocorrência já aconteceu: marca como paga/recebida; as próximas ficam previstas
      const { error: e2 } = await supabase
        .from("transactions")
        .update({ status: "paid", paid_at: paidAt })
        .eq("recurring_rule_id", rule.id)
        .eq("occurrence_date", v.date);
      if (e2) return { ok: false, error: dbError(e2) };
    }
    return done(cardId ? "Assinatura no cartão registrada" : "Lançamento recorrente criado");
  }

  /* ---- nova compra no cartão ---- */
  if (cardId) {
    const { error } = await supabase.rpc("save_card_purchase", {
      p_id: null,
      p_card_id: cardId,
      p_kind: "purchase",
      p_description: v.description,
      p_total_cents: v.amount,
      p_purchase_date: v.date,
      p_installments: v.installments,
      p_category_id: v.categoryId,
      p_notes: v.notes,
    });
    if (error) return { ok: false, error: dbError(error) };
    return done(v.installments > 1 ? `Compra em ${v.installments}x registrada` : "Compra no cartão registrada");
  }

  /* ---- nova receita/despesa na conta ---- */
  const { error } = await supabase.from("transactions").insert({
    type: v.kind,
    description: v.description,
    amount_cents: v.amount,
    date: v.date,
    status: v.status,
    paid_at: paidAt,
    account_id: accountId,
    category_id: v.categoryId,
    payment_method: v.paymentMethod,
    notes: v.notes,
  });
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

/** Encerra uma recorrência a partir de uma data (inclusive). Lançamentos já pagos ficam. */
export async function endRecurring(ruleId: string, from: string): Promise<ActionResult> {
  const p = isoDate.safeParse(from);
  if (!p.success) return { ok: false, error: "Data inválida" };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("end_recurring_rule", { p_rule_id: ruleId, p_from: p.data });
  if (error) return { ok: false, error: dbError(error) };
  return done("Recorrência encerrada");
}
