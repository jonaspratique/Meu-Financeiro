import { requireUser } from "@/lib/supabase/server";
import { getAccounts, getCategories } from "@/lib/data/queries";
import { AppShell } from "@/components/shell/app-shell";
import { EntryProvider } from "@/components/entry/entry-provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);
  return (
    <EntryProvider accounts={accounts} categories={categories}>
      <AppShell email={user.email ?? ""}>{children}</AppShell>
    </EntryProvider>
  );
}
