import { Inbox } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { MonthNav } from "@/components/common/month-nav";
import { FilterBar } from "@/components/common/filter-bar";
import { Money } from "@/components/common/money";
import { EntryList, type ListItem } from "@/components/entry/entry-list";
import { NewEntryButton } from "@/components/entry/new-entry-button";
import {
  getAccounts, getCardPurchasesInRange, getCardRefundTotals, getCards, getCategories, getInstallmentsInRange,
  getRefundTotals, getStatementPaymentsInRange, getTransactionsInRange, getTransfersInRange,
} from "@/lib/data/queries";
import { inRange, monthKeyOf, monthRange, parseMonthParam, todayISO } from "@/lib/finance/dates";
import { installmentEntry, summarize, type Entry } from "@/lib/finance/summary";

export const metadata = { title: "Movimentações" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const STATUS: Record<string, string> = { efetivado: "paid", pendente: "pending", cancelado: "cancelled" };
const TYPES = ["despesa", "receita", "estorno", "transferencia", "cartao"] as const;
type TypeFilter = (typeof TYPES)[number] | "";

function normalize(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Tipo de cada item para o filtro (um item pode casar com mais de um, ex.: compra no cartão = despesa e cartão). */
function typesOf(it: ListItem): TypeFilter[] {
  switch (it.kind) {
    case "transfer":
      return ["transferencia"];
    case "payment":
      return ["cartao"];
    case "card":
      return it.t.kind === "purchase" || it.t.kind === "fee" ? ["despesa", "cartao"] : ["estorno", "cartao"];
    default:
      return it.t.type === "income" ? ["receita"] : it.t.type === "expense" ? ["despesa"] : ["estorno"];
  }
}

export default async function MovimentacoesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = todayISO();
  const currentMonth = monthKeyOf(today);
  const month = parseMonthParam(sp.m, today);
  const range = monthRange(month);
  const tipo = (TYPES as readonly string[]).includes(one(sp.tipo)) ? (one(sp.tipo) as TypeFilter) : "";
  const f = { status: STATUS[one(sp.status)] ?? "", conta: one(sp.conta), cat: one(sp.cat), q: normalize(one(sp.q).trim()) };

  const [accounts, categories, cards, txns, transfers, purchases, payments, installments] = await Promise.all([
    getAccounts(),
    getCategories(),
    getCards(),
    getTransactionsInRange(range.from, range.to),
    getTransfersInRange(range.from, range.to),
    getCardPurchasesInRange(range.from, range.to),
    getStatementPaymentsInRange(range.from, range.to),
    getInstallmentsInRange(range.from, range.to),
  ]);

  const matches = (it: ListItem) => {
    if (tipo && !typesOf(it).includes(tipo)) return false;
    // cartão e pagamentos são sempre efetivados
    const status = it.kind === "card" || it.kind === "payment" ? "paid" : it.t.status;
    if (f.status && status !== f.status) return false;
    if (f.conta) {
      const ok =
        it.kind === "transfer" ? it.t.fromAccountId === f.conta || it.t.toAccountId === f.conta
        : it.kind === "card" ? it.t.cardId === f.conta
        : it.kind === "payment" ? it.t.accountId === f.conta || it.t.cardId === f.conta
        : it.t.accountId === f.conta;
      if (!ok) return false;
    }
    if (f.cat) {
      const cat = it.kind === "transaction" || it.kind === "card" ? it.t.categoryId : null;
      if (cat !== f.cat) return false;
    }
    if (f.q && !normalize(`${it.t.description} ${it.t.notes ?? ""}`).includes(f.q)) return false;
    return true;
  };

  // A lista do mês usa a data do lançamento (competência) / data da compra / data do pagamento
  const items: ListItem[] = [
    ...txns.filter((t) => inRange(t.date, range)).map((t) => ({ kind: "transaction" as const, t })),
    ...transfers.map((t) => ({ kind: "transfer" as const, t })),
    ...purchases.map((t) => ({ kind: "card" as const, t })),
    ...payments.map((t) => ({ kind: "payment" as const, t })),
  ]
    .filter(matches)
    .sort((a, b) => (a.t.date === b.t.date ? (a.t.createdAt < b.t.createdAt ? 1 : -1) : a.t.date < b.t.date ? 1 : -1));

  // Totais por competência: lançamentos de conta listados + PARCELAS do cartão com competência no mês
  // (uma compra de meses anteriores entra aqui com a parcela deste mês).
  const entries: Entry[] = items.filter((i) => i.kind === "transaction").map((i) => i.t as Entry);
  for (const inst of installments) {
    const p = inst.purchase;
    if (!p) continue;
    const pseudo: ListItem = {
      kind: "card",
      t: {
        id: inst.purchaseId, cardId: inst.cardId, kind: p.kind, description: p.description, totalCents: p.totalCents,
        purchaseDate: p.purchaseDate, date: p.purchaseDate, status: "paid", installments: p.installments,
        categoryId: p.categoryId, refundOfId: null, recurringRuleId: null, occurrenceDate: null, notes: null, createdAt: "",
      },
    };
    if (matches(pseudo)) entries.push(installmentEntry({ amountCents: inst.amountCents, competenceDate: inst.competenceDate, categoryId: p.categoryId }));
  }
  const totals = summarize(entries, range, "competencia");

  const [refunded, cardRefunded] = await Promise.all([
    getRefundTotals(items.filter((i) => i.kind === "transaction" && i.t.type === "expense").map((i) => i.t.id)),
    getCardRefundTotals(items.filter((i) => i.kind === "card" && i.t.kind === "purchase").map((i) => i.t.id)),
  ]);
  const params = {
    m: month === currentMonth ? undefined : month,
    tipo: tipo || undefined,
    status: one(sp.status) || undefined,
    conta: f.conta || undefined,
    cat: f.cat || undefined,
    q: one(sp.q) || undefined,
  };

  return (
    <>
      <PageHeader
        title="Movimentações"
        description="Receitas, despesas, compras no cartão, estornos e transferências do mês."
        actions={
          <>
            <MonthNav month={month} base="/movimentacoes" params={params} current={currentMonth} />
            <NewEntryButton className="hidden md:inline-flex" variant="brand" />
          </>
        }
      />
      <FilterBar accounts={accounts} categories={categories} cards={cards} />

      <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:max-w-lg">
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <p className="text-[11px] text-muted-foreground">Receitas</p>
          <Money cents={totals.income} tone="positive" className="text-sm font-semibold" />
        </div>
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <p className="text-[11px] text-muted-foreground">Despesas</p>
          <Money cents={totals.expense} tone="negative" className="text-sm font-semibold" />
        </div>
        <div className="rounded-xl bg-card px-3 py-2 ring-1 ring-border">
          <p className="text-[11px] text-muted-foreground">Resultado</p>
          <Money cents={totals.result} tone="auto" className="text-sm font-semibold" />
        </div>
      </div>

      <Card className="mt-4 pb-2 pt-1">
        {items.length ? (
          <EntryList items={items} groupByDay refundedByExpense={refunded} refundedByPurchase={cardRefunded} />
        ) : (
          <EmptyState icon={<Inbox />} title="Nenhuma movimentação encontrada" description="Ajuste os filtros ou registre um novo lançamento." action={<NewEntryButton size="sm" />} />
        )}
      </Card>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {items.length} {items.length === 1 ? "item" : "itens"} · totais por competência: compras no cartão entram pela parcela do mês;
        transferências e pagamentos de fatura não são despesa
      </p>
    </>
  );
}
