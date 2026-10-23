import Link from "next/link";
import { CreditCard, Scale } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, Progress } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Money } from "@/components/common/money";
import { IconBadge } from "@/components/icon";
import { getAccounts, getAdjustments, getBalances, getCardBalances, getCards, getStatementTotals } from "@/lib/data/queries";
import { currentStatementMonth, statementBalance, statementDates } from "@/lib/finance/cards";
import { CardActions, CardIcon, NewCardButton } from "../cartoes/card-forms";
import { formatDateBR, todayISO } from "@/lib/finance/dates";
import { computeOverview } from "@/lib/finance/overview";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_LABEL } from "@/lib/types";
import { AccountActions, DeleteAdjustmentButton, NewAccountButton } from "./account-forms";

export const metadata = { title: "Contas e cartões" };

export default async function ContasPage() {
  const today = todayISO();
  const [accounts, balances, adjustments, cards, cardBalances, statementTotals] = await Promise.all([
    getAccounts(),
    getBalances(today),
    getAdjustments(),
    getCards(),
    getCardBalances(today),
    getStatementTotals(),
  ]);
  const activeCards = cards.filter((c) => !c.archived);
  const archivedCards = cards.filter((c) => c.archived);
  let cardDebt = 0;
  for (const v of cardBalances.values()) cardDebt += v;
  const byId = new Map(balances.map((b) => [b.accountId, b]));
  const overview = computeOverview(accounts, balances, cardDebt);
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <>
      <PageHeader
        title="Contas e cartões"
        description="Saldos calculados a partir do saldo inicial e das movimentações efetivadas."
        actions={<NewAccountButton isFirst={accounts.length === 0} />}
      />

      <div className={cn("mb-4 grid gap-3", cards.length ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3")}>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total em contas</p>
          <Money cents={overview.totalBalance} className="text-lg font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Reservado</p>
          <Money cents={overview.reserved} className="text-lg font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Disponível</p>
          <Money cents={overview.available} className="text-lg font-semibold" />
        </Card>
        {cards.length > 0 && (
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Dívida nos cartões</p>
            <Money cents={cardDebt} className="text-lg font-semibold" />
          </Card>
        )}
      </div>

      {active.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma conta cadastrada" description="Comece pela conta que você mais usa no dia a dia." />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((a) => {
            const b = byId.get(a.id);
            const balance = b?.balanceCents ?? a.initialBalanceCents;
            const reserved = b?.reservedCents ?? 0;
            return (
              <Card key={a.id} className="p-5">
                <div className="flex items-start gap-3">
                  <IconBadge name={a.icon} color={a.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ACCOUNT_TYPE_LABEL[a.type]}
                      {a.isDefault && " · padrão"}
                    </p>
                  </div>
                  <AccountActions account={a} balance={balance} />
                </div>
                <Money cents={balance} tone={balance < 0 ? "negative" : "none"} className="mt-4 block text-2xl font-semibold tracking-tight" />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {reserved > 0 && <Badge tone="brand">Reservado: <Money cents={reserved} /></Badge>}
                  {!a.isOperational && <Badge>Fora do disponível</Badge>}
                  {!b && <Badge tone="warning">Inicia em {formatDateBR(a.initialBalanceDate)}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <section className="mt-6" aria-labelledby="cartoes-titulo">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="cartoes-titulo" className="text-base font-semibold">Cartões de crédito</h2>
            <p className="text-xs text-muted-foreground">Dívida inclui parcelas futuras. Limite nunca conta como dinheiro disponível.</p>
          </div>
          <NewCardButton accounts={accounts} />
        </div>
        {activeCards.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CreditCard />}
              title="Nenhum cartão cadastrado"
              description="Cadastre com o dia de fechamento e de vencimento. As compras parceladas entram automaticamente nas faturas certas."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeCards.map((c) => {
              const used = cardBalances.get(c.id) ?? 0;
              const month = currentStatementMonth(today, c.closingDay);
              const st = statementTotals.find((t) => t.cardId === c.id && t.month === month);
              const open = st ? statementBalance(st) : 0;
              const dates = st ? { due: st.dueDate } : statementDates(month, c.closingDay, c.dueDay);
              const overdue = statementTotals.filter((t) => t.cardId === c.id && t.dueDate < today && statementBalance(t) > 0);
              const pct = c.limitCents > 0 ? (used / c.limitCents) * 100 : 0;
              return (
                <Card key={c.id} className="relative p-5 transition hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <CardIcon color={c.color} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/cartoes/${c.id}`} className="truncate font-medium after:absolute after:inset-0">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">Fecha dia {c.closingDay} · vence dia {c.dueDay}</p>
                    </div>
                    <div className="relative z-10">
                      <CardActions card={c} accounts={accounts} />
                    </div>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">Fatura atual · vence {formatDateBR(dates.due)}</p>
                  <Money cents={Math.max(open, 0)} className="block text-2xl font-semibold tracking-tight" />
                  <Progress value={pct} className="mt-3" color={pct >= 90 ? "var(--negative)" : pct >= 70 ? "var(--warning)" : c.color} />
                  <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                    <span>
                      Usado <Money cents={used} />
                    </span>
                    <span>
                      Disponível <Money cents={c.limitCents - used} />
                    </span>
                  </div>
                  {overdue.length > 0 && (
                    <Badge tone="negative" className="mt-2">
                      {overdue.length === 1 ? "1 fatura vencida" : `${overdue.length} faturas vencidas`}
                    </Badge>
                  )}
                </Card>
              );
            })}
          </div>
        )}
        {archivedCards.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Arquivados:{" "}
            {archivedCards.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <Link href={`/cartoes/${c.id}`} className="underline">
                  {c.name}
                </Link>
              </span>
            ))}
          </p>
        )}
      </section>

      {adjustments.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Histórico de conciliações" description="Ajustes manuais de saldo, com justificativa." />
          <ul className="divide-y pb-2 pt-2">
            {adjustments.map((adj) => (
              <li key={adj.id} className="flex items-center gap-3 px-5 py-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Scale className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{adj.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {accounts.find((a) => a.id === adj.accountId)?.name} · {formatDateBR(adj.date)} · sistema{" "}
                    <Money cents={adj.systemBalanceCents} /> → banco <Money cents={adj.reportedBalanceCents} />
                  </p>
                </div>
                <Money cents={adj.amountCents} tone="auto" sign className="text-sm font-semibold" />
                <DeleteAdjustmentButton id={adj.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {archived.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Contas arquivadas" description="Mantidas para preservar o histórico." />
          <CardBody className="grid grid-cols-1 gap-2">
            {archived.map((a) => (
              <div key={a.id} className="flex items-center gap-3">
                <IconBadge name={a.icon} color={a.color} className="opacity-60" />
                <span className="flex-1 text-sm text-muted-foreground">{a.name}</span>
                <Money cents={byId.get(a.id)?.balanceCents ?? 0} tone="muted" className="text-sm" />
                <AccountActions account={a} balance={byId.get(a.id)?.balanceCents ?? 0} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </>
  );
}
