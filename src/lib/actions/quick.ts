"use server";

import { requireUser } from "@/lib/supabase/server";

/** Descrições já usadas → categoria (mais recentes primeiro), para o lançamento por frase aprender. */
export async function getQuickHints(): Promise<{ description: string; categoryId: string; kind: "income" | "expense" }[]> {
  const { supabase } = await requireUser();
  const [t, c] = await Promise.all([
    supabase.from("transactions").select("description, category_id, type").in("type", ["income", "expense"])
      .order("created_at", { ascending: false }).limit(400),
    supabase.from("credit_card_purchases").select("description, category_id").eq("kind", "purchase")
      .order("created_at", { ascending: false }).limit(200),
  ]);
  const out: { description: string; categoryId: string; kind: "income" | "expense" }[] = [];
  const seen = new Set<string>();
  for (const r of t.data ?? []) {
    const key = `${r.type}|${String(r.description).toLowerCase()}`;
    if (seen.has(key) || !r.category_id) continue;
    seen.add(key);
    out.push({ description: r.description, categoryId: r.category_id, kind: r.type });
  }
  for (const r of c.data ?? []) {
    const key = `expense|${String(r.description).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ description: r.description, categoryId: r.category_id, kind: "expense" });
  }
  return out;
}
