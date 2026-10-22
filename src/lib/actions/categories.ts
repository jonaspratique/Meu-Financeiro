"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { categorySchema, firstIssue, type ActionResult } from "@/lib/validation";
import { dbError } from "./errors";

const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

export async function saveCategory(input: {
  id?: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  isFixed: boolean;
}): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const { supabase } = await requireUser();
  const row = { name: v.name, kind: v.kind, color: v.color, is_fixed: v.isFixed };
  // o tipo (receita/despesa) não muda depois de criado, para não invalidar lançamentos
  const { error } = v.id
    ? await supabase.from("categories").update({ name: row.name, color: row.color, is_fixed: row.is_fixed }).eq("id", v.id)
    : await supabase.from("categories").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  return done(v.id ? "Categoria atualizada" : "Categoria criada");
}

export async function setCategoryArchived(id: string, archived: boolean): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("categories")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  return done(archived ? "Categoria arquivada" : "Categoria reativada");
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { ok: false, error: "A categoria está em uso. Arquive-a para escondê-la dos formulários." };
    return { ok: false, error: dbError(error) };
  }
  return done("Categoria excluída");
}
