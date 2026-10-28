import "server-only";
import { requireUser } from "@/lib/supabase/server";
import { addDaysISO, buildAlerts } from "@/lib/finance/alerts";
import type { ISODate } from "@/lib/finance/dates";

/** Os mesmos avisos das notificações, para o card do início. */
export async function getTodayAlerts(today: ISODate) {
  const { supabase } = await requireUser();
  const [acc, bal, pend, st, cards] = await Promise.all([
    supabase.from("accounts").select("id, name, archived_at"),
    supabase.rpc("account_balances", { p_as_of: today }),
    supabase
      .from("transactions")
      .select("id, type, amount_cents, date, account_id, description")
      .eq("status", "pending")
      .in("type", ["income", "expense"])
      .gte("date", addDaysISO(today, -7))
      .lte("date", addDaysISO(today, 7)),
    supabase
      .from("credit_card_statement_totals")
      .select("statement_id, card_id, due_date, charges_cents, credits_cents, payments_cents")
      .gte("due_date", addDaysISO(today, -5))
      .lte("due_date", addDaysISO(today, 7)),
    supabase.from("credit_cards").select("id, name, payment_account_id"),
  ]);
  for (const r of [acc, bal, pend, st, cards]) if (r.error) throw new Error(r.error.message);
  const cardById = new Map((cards.data ?? []).map((c) => [c.id as string, c]));
  return buildAlerts({
    today,
    accounts: (acc.data ?? []).map((a) => ({ id: a.id, name: a.name, archived: a.archived_at != null })),
    balances: ((bal.data ?? []) as { account_id: string; balance_cents: number; reserved_cents: number }[]).map((b) => ({
      accountId: b.account_id,
      balanceCents: Number(b.balance_cents),
      reservedCents: Number(b.reserved_cents),
    })),
    pending: (pend.data ?? []).map((t) => ({
      id: t.id,
      type: t.type as "income" | "expense",
      amountCents: Number(t.amount_cents),
      date: t.date,
      accountId: t.account_id,
      description: t.description,
    })),
    statements: (st.data ?? []).map((s) => {
      const card = cardById.get(s.card_id);
      return {
        id: s.statement_id,
        cardId: s.card_id,
        cardName: card?.name ?? "Cartão",
        paymentAccountId: card?.payment_account_id ?? null,
        dueDate: s.due_date,
        remainingCents: Number(s.charges_cents) - Number(s.credits_cents) - Number(s.payments_cents),
      };
    }),
  });
}
