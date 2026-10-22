import { CreditCard, Scale } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Money } from "@/components/common/money";
import { IconBadge } from "@/components/icon";
import { getAccounts, getAdjustments, getBalances } from "@/lib/data/queries";
import { formatDateBR, todayISO } from "@/lib/finance/dates";
import { computeOverview } from "@/lib/finance/overview";
import { ACCOUNT_TYPE_LABEL } from "@/lib/types";
import { AccountActions, DeleteAdjustmentButton, NewAccountButton } from "./account-forms";

export const metadata = { title: "Contas e cartões" };

export default async function ContasPage() {
  const today = todayISO();
  const [accounts, balances, adjustments] = await Promise.all([getAccounts(), getBalances(today), getAdjustments()]);
  const byId = new Map(balances.map((b) => [b.accountId, b]));
  const overview = computeOverview(accounts, balances);
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  return (
    <>
      <PageHeader
        title="Contas e cartões"
        description="Saldos calculados a partir do saldo inicial e das movimentações efetivadas."
        actions={<NewAccountButton isFirst={accounts.length === 0} />}
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
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

      <Card className="mt-4">
        <CardHeader title="Cartões de crédito" description="Faturas, parcelamentos e pagamentos chegam na Fase 2." />
        <EmptyState
          icon={<CreditCard />}
          title="Em breve"
          description="Limite de crédito nunca será somado ao seu dinheiro disponível. Por enquanto, registre o pagamento da fatura como despesa."
        />
      </Card>

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
          <CardBody className="grid gap-2">
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
