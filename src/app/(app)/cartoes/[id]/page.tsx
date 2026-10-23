import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, CreditCard, Inbox } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Progress } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Money } from "@/components/common/money";
import { EntryList, type ListItem } from "@/components/entry/entry-list";
import { NewEntryButton } from "@/components/entry/new-entry-button";
import {
  getAccounts, getCardBalances, getCardPurchasesByIds, getCardRefundTotals, getCards, getCategories,
  getStatementInstallments, getStatementPayments, getStatementTotals,
} from "@/lib/data/queries";
import { formatDateBR, formatMonthLong, formatMonthShort, isMonthKey, shiftMonth, todayISO } from "@/lib/finance/dates";
import {
  currentStatementMonth, daysUntil, statementBalance, statementDates, statementState, STATEMENT_STATE_LABEL, type StatementState,
} from "@/lib/finance/cards";
import { cn } from "@/lib/utils";
import { AdjustmentButton, CardActions, PayStatementButton } from "../card-forms";

export const metadata = { title: "Fatura do cartão" };

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

const STATE_TONE: Record<StatementState, "neutral" | "positive" | "negative" | "warning" | "brand"> = {
  open: "brand",
  closed: "warning",
  overdue: "negative",
  paid: "positive",
  credit: "positive",
  empty: "neutral",
};

export default async function CardPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const today = todayISO();
  const [cards, accounts, categories, allTotals, balances] = await Promise.all([
    getCards(),
    getAccounts(),
    getCategories(),
    getStatementTotals(),
    getCardBalances(today),
  ]);
  const card = cards.find((c) => c.id === id);
  if (!card) notFound();

  const current = currentStatementMonth(today, card.closingDay);
  const m = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const month = isMonthKey(m) ? m : current;
  const totals = allTotals.filter((t) => t.cardId === card.id);
  const st = totals.find((t) => t.month === month);
  const dates = st ? { closing: st.closingDate, due: st.dueDate } : statementDates(month, card.closingDay, card.dueDay);
  const t = st ?? { closingDate: dates.closing, dueDate: dates.due, chargesCents: 0, creditsCents: 0, paymentsCents: 0 };
  const balance = statementBalance(t);
  const state = statementState(t, today);

  const [installments, payments] = st
    ? await Promise.all([getStatementInstallments(st.statementId), getStatementPayments(st.statementId)])
    : [[], []];
  const purchases = await getCardPurchasesByIds([...new Set(installments.map((i) => i.purchaseId))]);
  const byId = new Map(purchases.map((p) => [p.id, p]));
  const refunded = await getCardRefundTotals(purchases.filter((p) => p.kind === "purchase").map((p) => p.id));

  const items: ListItem[] = [
    ...installments
      .filter((i) => byId.has(i.purchaseId))
      .map((i) => ({
        kind: "card" as const,
        t: { ...byId.get(i.purchaseId)!, date: i.competenceDate },
        installment: { number: i.number, totalNumber: i.totalNumber, amountCents: i.amountCents },
      })),
    ...payments.map((p) => ({ kind: "payment" as const, t: p })),
  ].sort((a, b) => (a.t.date < b.t.date ? 1 : -1));

  const used = balances.get(card.id) ?? 0;
  const available = card.limitCents - used;
  const usedPct = card.limitCents > 0 ? (used / card.limitCents) * 100 : 0;
  const upcoming = totals.filter((x) => x.month > month && statementBalance(x) > 0).slice(0, 6);
  const dueIn = daysUntil(today, t.dueDate);

  const nav = "flex size-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground";
  const link = (k: string) => `/cartoes/${card.id}${k === current ? "" : `?m=${k}`}`;

  return (
    <>
      <Link href="/contas" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Contas e cartões
      </Link>
      <PageHeader
        title={card.name}
        description={`Fecha dia ${card.closingDay} · vence dia ${card.dueDay}${card.archived ? " · arquivado" : ""}`}
        actions={
          <>
            <AdjustmentButton cardId={card.id} categories={categories} />
            {!card.archived && <NewEntryButton variant="brand" label="Nova compra" cardId={card.id} />}
            <CardActions card={card} accounts={accounts} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-2xl border bg-card p-1">
              <Link href={link(shiftMonth(month, -1))} className={nav} aria-label="Fatura anterior" scroll={false}>
                <ChevronLeft className="size-4" />
              </Link>
              <span className="min-w-36 text-center text-sm font-medium">Fatura de {formatMonthLong(month).toLowerCase()}</span>
              <Link href={link(shiftMonth(month, 1))} className={nav} aria-label="Próxima fatura" scroll={false}>
                <ChevronRight className="size-4" />
              </Link>
              {month !== current && (
                <Link href={link(current)} className="ml-1 rounded-lg px-2 py-1.5 text-xs font-medium text-brand hover:bg-muted" scroll={false}>
                  Atual
                </Link>
              )}
            </div>
            <Badge tone={STATE_TONE[state]}>{STATEMENT_STATE_LABEL[state]}</Badge>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{balance < 0 ? "Crédito a favor" : state === "open" ? "Fatura parcial (ainda aberta)" : "Saldo a pagar"}</p>
              <Money cents={Math.abs(balance)} tone={balance < 0 ? "positive" : "none"} className="text-3xl font-semibold tracking-tight" />
              <p className="mt-1 text-xs text-muted-foreground">
                Fecha em {formatDateBR(t.closingDate)} · vence em {formatDateBR(t.dueDate)}
                {balance > 0 && dueIn >= 0 && dueIn <= 10 && <span className="font-medium text-warning"> · faltam {dueIn} {dueIn === 1 ? "dia" : "dias"}</span>}
              </p>
            </div>
            {balance > 0 && !card.archived && (
              <PayStatementButton
                statementId={st!.statementId}
                remaining={balance}
                accounts={accounts}
                defaultAccountId={card.paymentAccountId}
                dueDate={t.dueDate}
              />
            )}
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
            {[
              ["Compras e tarifas", t.chargesCents, "none"],
              ["Estornos e créditos", t.creditsCents ? -t.creditsCents : 0, "positive"],
              ["Pagamentos", t.paymentsCents ? -t.paymentsCents : 0, "none"],
            ].map(([label, v, tone]) => (
              <div key={label as string} className="rounded-xl bg-muted/50 px-2 py-2">
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd>
                  <Money cents={v as number} tone={(v as number) === 0 ? "muted" : (tone as "none" | "positive")} className="text-sm font-semibold" />
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-5">
          <p className="text-xs text-muted-foreground">Limite usado</p>
          <Money cents={used} className="text-xl font-semibold" />
          <Progress
            value={usedPct}
            className="mt-3"
            color={usedPct >= 90 ? "var(--negative)" : usedPct >= 70 ? "var(--warning)" : card.color}
          />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>
              Disponível: <Money cents={available} tone={available < 0 ? "negative" : "none"} />
            </span>
            <span>
              Limite: <Money cents={card.limitCents} />
            </span>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Inclui parcelas futuras. O limite não entra no seu saldo disponível; a dívida do cartão é descontada do patrimônio.
          </p>
          {upcoming.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <CalendarClock className="size-3.5 text-muted-foreground" /> Próximas faturas
              </p>
              <ul className="grid grid-cols-1 gap-1.5">
                {upcoming.map((u) => (
                  <li key={u.statementId}>
                    <Link href={link(u.month)} className="flex justify-between rounded-lg px-1 text-sm hover:bg-muted">
                      <span className="text-muted-foreground">{formatMonthShort(u.month)} · vence {formatDateBR(u.dueDate).slice(0, 5)}</span>
                      <Money cents={statementBalance(u)} className="font-medium" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card className={cn("mt-4 pb-2")}>
        <CardHeader title="Lançamentos desta fatura" description="Parcelas, estornos, tarifas e pagamentos" />
        <div className="pt-2">
          {items.length ? (
            <EntryList items={items} refundedByPurchase={refunded} />
          ) : (
            <EmptyState
              icon={st ? <Inbox /> : <CreditCard />}
              title="Nenhum lançamento nesta fatura"
              description={`Compras feitas até ${formatDateBR(t.closingDate)} (exclusive) entram aqui.`}
            />
          )}
        </div>
      </Card>
    </>
  );
}
