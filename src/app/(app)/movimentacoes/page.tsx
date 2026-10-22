import { Inbox } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { MonthNav } from "@/components/common/month-nav";
import { FilterBar } from "@/components/common/filter-bar";
import { Money } from "@/components/common/money";
import { EntryList, type ListItem } from "@/components/entry/entry-list";
import { NewEntryButton } from "@/components/entry/new-entry-button";
import {
  getAccounts, getCategories, getRefundTotals, getTransactionsInRange, getTransfersInRange,
} from "@/lib/data/queries";
import { inRange, monthKeyOf, monthRange, parseMonthParam, todayISO } from "@/lib/finance/dates";

export const metadata = { title: "Movimentações" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STATUS: Record<string, string> = { efetivado: "paid", pendente: "pending", cancelado: "cancelled" };
const TYPES: Record<string, string> = { despesa: "expense", receita: "income", estorno: "refund", transferencia: "transfer" };

function normalize(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export default async function MovimentacoesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = todayISO();
  const currentMonth = monthKeyOf(today);
  const month = parseMonthParam(sp.m, today);
  const range = monthRange(month);
  const f = {
    tipo: TYPES[one(sp.tipo)] ?? "",
    status: STATUS[one(sp.status)] ?? "",
    conta: one(sp.conta),
    cat: one(sp.cat),
    q: normalize(one(sp.q).trim()),
  };

  const [accounts, categories, txns, transfers] = await Promise.all([
    getAccounts(),
    getCategories(),
    getTransactionsInRange(range.from, range.to),
    getTransfersInRange(range.from, range.to),
  ]);

  // A lista do mês usa a data do lançamento (competência)
  let items: ListItem[] = [
    ...txns.filter((t) => inRange(t.date, range)).map((t) => ({ kind: "transaction" as const, t })),
    ...transfers.map((t) => ({ kind: "transfer" as const, t })),
  ];

  items = items.filter((it) => {
    const type = it.kind === "transfer" ? "transfer" : it.t.type;
    if (f.tipo && type !== f.tipo) return false;
    if (f.status && it.t.status !== f.status) return false;
    if (f.conta) {
      const ok = it.kind === "transfer" ? it.t.fromAccountId === f.conta || it.t.toAccountId === f.conta : it.t.accountId === f.conta;
      if (!ok) return false;
    }
    if (f.cat && (it.kind === "transfer" || it.t.categoryId !== f.cat)) return false;
    if (f.q && !normalize(`${it.t.description} ${it.t.notes ?? ""}`).includes(f.q)) return false;
    return true;
  });
  items.sort((a, b) => (a.t.date === b.t.date ? (a.t.createdAt < b.t.createdAt ? 1 : -1) : a.t.date < b.t.date ? 1 : -1));

  let income = 0;
  let expense = 0;
  for (const it of items) {
    if (it.kind === "transfer" || it.t.status === "cancelled") continue;
    if (it.t.type === "income") income += it.t.amountCents;
    else if (it.t.type === "expense") expense += it.t.amountCents;
    else expense -= it.t.amountCents;
  }

  const refunded = await getRefundTotals(
    items.filter((i) => i.kind === "transaction" && i.t.type === "expense").map((i) => i.t.id),
  );
  const params = { m: month === currentMonth ? undefined : month, tipo: one(sp.tipo) || undefined, status: one(sp.status) || undefined, conta: f.conta || undefined, cat: f.cat || undefined, q: one(sp.q) || undefined };

  return (
    <>
      <PageHeader
        title="Movimentações"
        description="Receitas, despesas, estornos e transferências do mês."
        actions={
          <>
            <MonthNav month={month} base="/movimentacoes" params={params} current={currentMonth} />
            <NewEntryButton className="hidden md:inline-flex" variant="brand" />
          </>
        }
      />
      <FilterBar accounts={accounts} categories={categories} />

      <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:max-w-lg">
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <p className="text-[11px] text-muted-foreground">Receitas</p>
          <Money cents={income} tone="positive" className="text-sm font-semibold" />
        </div>
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <p className="text-[11px] text-muted-foreground">Despesas</p>
          <Money cents={expense} tone="negative" className="text-sm font-semibold" />
        </div>
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <p className="text-[11px] text-muted-foreground">Saldo</p>
          <Money cents={income - expense} tone="auto" className="text-sm font-semibold" />
        </div>
      </div>

      <Card className="mt-4 pb-2 pt-1">
        {items.length ? (
          <EntryList items={items} groupByDay refundedByExpense={refunded} />
        ) : (
          <EmptyState icon={<Inbox />} title="Nenhuma movimentação encontrada" description="Ajuste os filtros ou registre um novo lançamento." action={<NewEntryButton size="sm" />} />
        )}
      </Card>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {items.length} {items.length === 1 ? "lançamento" : "lançamentos"} · totais por competência, sem cancelados e sem transferências
      </p>
    </>
  );
}
