"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { GOAL_KIND_ICON, type GoalKind } from "@/lib/types";
import { firstIssue, goalSchema, savingsMoveSchema, type ActionResult } from "@/lib/validation";
import { dbError } from "./errors";

const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

export async function saveGoal(input: {
  id?: string;
  name: string;
  kind: GoalKind;
  target: string;
  targetDate?: string;
  color: string;
  accountId?: string;
  /** só na criação: quanto já está guardado */
  saved?: string;
  /** "add": soma ao saldo da conta (dinheiro guardado à parte); "in_balance": já está no saldo */
  savedMode?: "add" | "in_balance";
}): Promise<ActionResult> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  if (v.saved > 0 && !v.accountId) return { ok: false, error: "Escolha a conta onde o dinheiro está guardado." };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_goal", {
    p_id: v.id ?? null,
    p_name: v.name,
    p_kind: v.kind,
    p_target_cents: v.target,
    p_target_date: v.targetDate ?? null,
    p_color: v.color,
    p_icon: GOAL_KIND_ICON[v.kind],
    p_account_id: v.accountId ?? null,
    p_saved_cents: v.id ? 0 : v.saved,
    p_saved_mode: v.savedMode,
  });
  if (error) return { ok: false, error: dbError(error) };
  if (v.id) return done("Reserva atualizada");
  return done(
    v.saved > 0
      ? v.savedMode === "add"
        ? "Reserva criada e valor somado ao saldo da conta"
        : "Reserva criada com o valor já guardado"
      : "Reserva criada",
  );
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("savings_goals").delete().eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done("Reserva excluída. O dinheiro continua nas contas, agora livre.");
}

export async function setGoalArchived(id: string, archived: boolean): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("savings_goals")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done(archived ? "Reserva arquivada" : "Reserva reativada");
}

/**
 * Aporte/retirada. Um aporte apenas ETIQUETA parte do saldo de uma conta
 * existente; não cria dinheiro nem gera despesa. Para guardar em outra conta
 * (ex.: poupança), registre antes uma transferência e aporte na conta destino.
 */
export async function saveSavingsMovement(input: {
  goalId: string;
  accountId: string;
  kind: "deposit" | "withdrawal";
  amount: string;
  date: string;
  notes?: string;
}): Promise<ActionResult> {
  const parsed = savingsMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const { error } = await supabase.from("savings_movements").insert({
    goal_id: v.goalId,
    account_id: v.accountId,
    kind: v.kind,
    amount_cents: v.amount,
    date: v.date,
    notes: v.notes,
  });
  if (error) return { ok: false, error: dbError(error) };
  return done(v.kind === "deposit" ? "Aporte registrado" : "Retirada registrada");
}

export async function deleteSavingsMovement(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("savings_movements").delete().eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done("Movimentação removida");
}
