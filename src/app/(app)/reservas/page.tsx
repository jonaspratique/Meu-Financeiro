import { PiggyBank } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, Progress } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Money } from "@/components/common/money";
import { IconBadge } from "@/components/icon";
import { LinesChart } from "@/components/charts/charts";
import { getAccounts, getBalances, getSavings } from "@/lib/data/queries";
import { formatDateBR, formatMonthShort, lastMonths, monthKeyOf, todayISO } from "@/lib/finance/dates";
import { goalProgress, reservesSeries, signed } from "@/lib/finance/savings";
import { DeleteMovementButton, GoalActions, NewGoalButton, type AccountOption } from "./goal-forms";

export const metadata = { title: "Minhas Reservas" };

export default async function ReservasPage() {
  const today = todayISO();
  const [{ goals, movements }, accounts, balances] = await Promise.all([getSavings(), getAccounts(), getBalances(today)]);
  const byId = new Map(balances.map((b) => [b.accountId, b]));

  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);
  const progress = new Map(goals.map((g) => [g.id, goalProgress(g, movements, today)]));
  const totalSaved = goals.reduce((a, g) => a + progress.get(g.id)!.saved, 0);
  const totalTarget = active.reduce((a, g) => a + g.targetCents, 0);
  const totalRemaining = active.reduce((a, g) => a + progress.get(g.id)!.remaining, 0);
  const suggested = active.reduce((a, g) => a + (progress.get(g.id)!.suggestedMonthly ?? 0), 0);

  const accountOptions = (goalId: string): AccountOption[] =>
    accounts
      .filter((a) => !a.archived && byId.has(a.id))
      .map((a) => {
        const b = byId.get(a.id)!;
        const inGoal = movements.filter((m) => m.goalId === goalId && m.accountId === a.id).reduce((s, m) => s + signed(m), 0);
        return { id: a.id, name: a.name, free: b.balanceCents - b.reservedCents, inGoal };
      });

  const months = lastMonths(monthKeyOf(today), 12);
  const evolution = reservesSeries(movements, months).map((p) => ({
    label: formatMonthShort(p.month),
    total: p.total,
  }));

  return (
    <>
      <PageHeader title="Minhas Reservas" description="Dinheiro separado para objetivos, sem contar em dobro." actions={<NewGoalButton />} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total reservado</p>
          <Money cents={totalSaved} className="text-lg font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Meta total</p>
          <Money cents={totalTarget} className="text-lg font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Falta</p>
          <Money cents={totalRemaining} className="text-lg font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Aporte mensal sugerido</p>
          <Money cents={suggested} className="text-lg font-semibold" />
          <p className="text-[11px] text-muted-foreground">para metas com prazo</p>
        </Card>
      </div>

      {active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PiggyBank />}
            title="Nenhuma reserva ainda"
            description="Crie uma reserva de emergência, para viagem ou para qualquer objetivo. Os aportes etiquetam parte do saldo das suas contas."
            action={<NewGoalButton />}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((g) => {
            const p = progress.get(g.id)!;
            const history = movements.filter((m) => m.goalId === g.id).slice(-5).reverse();
            return (
              <Card key={g.id} className="p-5">
                <div className="flex items-start gap-3">
                  <IconBadge name={g.icon} color={g.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Meta <Money cents={g.targetCents} />
                      {g.targetDate && ` · até ${formatDateBR(g.targetDate)}`}
                    </p>
                  </div>
                  {p.done ? <Badge tone="positive">Concluída</Badge> : p.overdue ? <Badge tone="negative">Prazo vencido</Badge> : null}
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <Money cents={p.saved} className="text-2xl font-semibold tracking-tight" />
                  <span className="tabular text-sm font-medium text-muted-foreground">{Math.floor(p.percent)}%</span>
                </div>
                <Progress value={p.percent} color={g.color} className="mt-2" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {p.done
                    ? "Meta atingida."
                    : p.suggestedMonthly != null
                      ? <>Faltam <Money cents={p.remaining} />. Guarde <strong className="text-foreground"><Money cents={p.suggestedMonthly} />/mês</strong> por {p.monthsLeft || 1} {p.monthsLeft === 1 ? "mês" : "meses"}.</>
                      : <>Faltam <Money cents={p.remaining} />. Defina um prazo para ver o aporte mensal sugerido.</>}
                </p>
                <div className="mt-4">
                  <GoalActions goal={g} accounts={accountOptions(g.id)} />
                </div>
                {history.length > 0 && (
                  <details className="mt-3 border-t pt-3">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Histórico recente</summary>
                    <ul className="mt-2 grid gap-1">
                      {history.map((m) => (
                        <li key={m.id} className="flex items-center gap-2 text-sm">
                          <span className="tabular w-20 text-xs text-muted-foreground">{formatDateBR(m.date)}</span>
                          <span className="flex-1 truncate text-xs text-muted-foreground">
                            {m.kind === "deposit" ? "Aporte" : "Retirada"} · {accounts.find((a) => a.id === m.accountId)?.name}
                          </span>
                          <Money cents={signed(m)} tone="auto" sign className="text-xs font-medium" />
                          <DeleteMovementButton id={m.id} />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {movements.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Evolução das reservas" description="Total reservado ao fim de cada mês" />
          <CardBody>
            <LinesChart caption="Total reservado nos últimos 12 meses" data={evolution} series={[{ key: "total", label: "Total reservado", color: "var(--chart-reserves)" }]} />
          </CardBody>
        </Card>
      )}

      {archived.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Reservas arquivadas" />
          <CardBody className="grid gap-3">
            {archived.map((g) => (
              <div key={g.id} className="flex items-center gap-3">
                <IconBadge name={g.icon} color={g.color} className="opacity-60" />
                <span className="flex-1 text-sm text-muted-foreground">{g.name}</span>
                <Money cents={progress.get(g.id)!.saved} tone="muted" className="text-sm" />
                <GoalActions goal={g} accounts={accountOptions(g.id)} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Como funciona: o aporte não move dinheiro nem cria despesa — ele marca parte do saldo de uma conta como reservada.
        Se quiser guardar em outra conta (ex.: poupança), faça antes uma transferência e depois aporte na conta de destino.
        O patrimônio soma apenas os saldos das contas; as reservas já estão dentro deles.
      </p>
    </>
  );
}
