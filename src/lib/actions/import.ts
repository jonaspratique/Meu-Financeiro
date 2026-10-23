"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { todayISO } from "@/lib/finance/dates";
import { dupKey, IMPORT_LIMIT, looseKey } from "@/lib/finance/csv-import";
import { firstIssue, isoDate } from "@/lib/validation";
import { dbError } from "./errors";

const target = z.string().regex(/^(card:)?[0-9a-f-]{36}$/i, "Escolha a conta ou o cartão.");
const parseTarget = (t: string) => (t.startsWith("card:") ? { cardId: t.slice(5), accountId: null } : { cardId: null, accountId: t });

/** Chaves dos lançamentos já existentes na conta/cartão (para marcar duplicados na prévia). */
export async function getImportExisting(input: { target: string; from: string; to: string }) {
  const p = z.object({ target, from: isoDate, to: isoDate }).safeParse(input);
  if (!p.success) return { strict: [] as string[], loose: [] as string[] };
  const { supabase } = await requireUser();
  const { cardId, accountId } = parseTarget(p.data.target);
  const rows: { date: string; amount: number; description: string }[] = [];
  if (cardId) {
    const { data } = await supabase
      .from("credit_card_purchases")
      .select("purchase_date, total_cents, description")
      .eq("card_id", cardId).gte("purchase_date", p.data.from).lte("purchase_date", p.data.to).limit(5000);
    for (const r of data ?? []) rows.push({ date: r.purchase_date, amount: Number(r.total_cents), description: r.description });
  } else {
    const { data } = await supabase
      .from("transactions")
      .select("date, amount_cents, description, status")
      .eq("account_id", accountId!).neq("status", "cancelled").gte("date", p.data.from).lte("date", p.data.to).limit(5000);
    for (const r of data ?? []) rows.push({ date: r.date, amount: Number(r.amount_cents), description: r.description });
  }
  return {
    strict: rows.map((r) => dupKey(r.date, r.amount, r.description)),
    loose: rows.map((r) => looseKey(r.date, r.amount)),
  };
}

const rowSchema = z.object({
  date: isoDate,
  description: z.string().trim().min(1).max(120),
  amountCents: z.number().int().refine((v) => v !== 0 && Math.abs(v) <= 100_000_000_00, "Valor inválido."),
  categoryId: z.string().uuid("Categoria inválida."),
});
const importSchema = z.object({
  target,
  rows: z.array(rowSchema).min(1, "Nenhuma linha selecionada.").max(IMPORT_LIMIT, `Importe no máximo ${IMPORT_LIMIT} linhas por vez.`),
});

export type ImportResult = { ok: true; message: string; imported: number } | { ok: false; error: string; imported: number };

/**
 * Grava as linhas conferidas pelo usuário.
 * Conta: entradas viram receitas e saídas despesas (efetivadas até hoje; futuras ficam pendentes).
 * Cartão: saídas viram compras à vista; entradas viram créditos na fatura.
 */
export async function importRows(input: { target: string; rows: z.input<typeof rowSchema>[] }): Promise<ImportResult> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error), imported: 0 };
  const { supabase } = await requireUser();
  const { cardId, accountId } = parseTarget(parsed.data.target);
  const rows = parsed.data.rows;
  const today = todayISO();

  const { data: cats, error: ce } = await supabase.from("categories").select("id, kind");
  if (ce) return { ok: false, error: dbError(ce), imported: 0 };
  const kindOf = new Map((cats ?? []).map((c) => [c.id as string, c.kind as string]));
  for (const r of rows) {
    const need = cardId ? "expense" : r.amountCents > 0 ? "income" : "expense";
    if (kindOf.get(r.categoryId) !== need) {
      return { ok: false, error: `Categoria incompatível em "${r.description}" (${need === "income" ? "use uma categoria de receita" : "use uma categoria de despesa"}).`, imported: 0 };
    }
  }

  if (accountId) {
    // tudo de uma vez: ou importa todas, ou nenhuma
    const { error } = await supabase.from("transactions").insert(
      rows.map((r) => ({
        type: r.amountCents > 0 ? "income" : "expense",
        description: r.description,
        amount_cents: Math.abs(r.amountCents),
        date: r.date,
        status: r.date <= today ? "paid" : "pending",
        paid_at: r.date <= today ? r.date : null,
        account_id: accountId,
        category_id: r.categoryId,
        payment_method: "other",
        notes: "Importado de CSV",
      })),
    );
    if (error) return { ok: false, error: dbError(error), imported: 0 };
  } else {
    let imported = 0;
    for (let i = 0; i < rows.length; i += 8) {
      const chunk = rows.slice(i, i + 8);
      const results = await Promise.all(
        chunk.map((r) =>
          supabase.rpc("save_card_purchase", {
            p_id: null,
            p_card_id: cardId,
            p_kind: r.amountCents < 0 ? "purchase" : "credit",
            p_description: r.description,
            p_total_cents: Math.abs(r.amountCents),
            p_purchase_date: r.date,
            p_installments: 1,
            p_category_id: r.categoryId,
            p_notes: "Importado de CSV",
          }),
        ),
      );
      const failed = results.find((x) => x.error);
      imported += results.filter((x) => !x.error).length;
      if (failed) {
        revalidatePath("/", "layout");
        return { ok: false, error: `${dbError(failed.error)} (${imported} de ${rows.length} já importadas)`, imported };
      }
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `${rows.length} ${rows.length === 1 ? "lançamento importado" : "lançamentos importados"}`, imported: rows.length };
}
