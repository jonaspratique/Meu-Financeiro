import { requireUser } from "@/lib/supabase/server";
import { ensureRecurring, getAccounts, getCards, getCategories, getRecurringRules } from "@/lib/data/queries";
import { todayISO } from "@/lib/finance/dates";
import { AppShell } from "@/components/shell/app-shell";
import { EntryProvider } from "@/components/entry/entry-provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  // cria as ocorrências previstas das recorrências (idempotente) antes de ler os dados
  await ensureRecurring(todayISO());
  const [accounts, categories, cards, rules] = await Promise.all([getAccounts(), getCategories(), getCards(), getRecurringRules()]);
  return (
    <EntryProvider accounts={accounts} categories={categories} cards={cards} rules={rules}>
      <AppShell email={user.email ?? ""}>{children}</AppShell>
    </EntryProvider>
  );
}
