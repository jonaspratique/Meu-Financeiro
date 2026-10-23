import Link from "next/link";
import { AlertTriangle, CalendarClock, Inbox, PieChart, WalletCards } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { MonthNav, RegimeToggle } from "@/components/common/month-nav";
import { Stat } from "@/components/common/stat";
import { CategoryBreakdown } from "@/components/common/category-breakdown";
import { BarsChart, LinesChart } from "@/components/charts/charts";
import { EntryList } from "@/components/entry/entry-list";
import { NewEntryButton } from "@/components/entry/new-entry-button";
import { QuickAddBar } from "@/components/entry/quick-add-bar";
import {
  getAccounts, getBalances, getBalanceSeries, getCategories, getRecentTransactions, getSavings, getTotalCardDebt, getUpcoming,
} from "@/lib/data/queries";
import { getEntriesInRange } from "@/lib/data/entries";
import { getBudgetUsage, getDueStatements } from "@/lib/data/planning";
import { DueStatementsList } from "@/components/planning/due-statements";
import { BudgetAlerts } from "@/components/planning/budget-alerts";
import { InsightsList } from "@/components/common/insights-list";
import { getInsights } from "@/lib/data/insights";
import { CARD_PAYMENT_PSEUDO_CATEGORY } from "@/lib/types";
import {
  formatMonthLong, formatMonthShort, lastMonths, monthKeyOf, monthRange, parseMonthParam, shiftMonth, todayISO,
} from "@/lib/finance/dates";
import { computeOverview } from "@/lib/finance/overview";
import { isRegime, monthlySeries, summarize } from "@/lib/finance/summary";

export const metadata = { title: "Dashboard" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = todayISO();
  const currentMonth = monthKeyOf(today);
  const month = parseMonthParam(sp.m, today);
  const regime = isRegime(sp.r) ? sp.r : "competencia";
  const params = { m: month === currentMonth ? undefined : month, r: regime === "competencia" ? undefined : regime };

  const months = lastMonths(month, 6);
  const range = monthRange(month);
  const asOf = range.to < today ? range.to : today; // fotografia no fim do mês (ou hoje)
  const monthEnds = months.map((m) => {
    const end = monthRange(m).to;
    return end < today ? end : today;
  });

  const [accounts, categories, entries, balances, savings, upcoming, recent, series, debt, debts, dueStatements, budgetUsage, insights] =
    await Promise.all([
      getAccounts(),
      getCategories(),
      getEntriesInRange(monthRange(months[0]).from, range.to),
      getBalances(asOf),
      getSavings(),
      getUpcoming(today, 30, 8),
      getRecentTransactions(6, today),
      getBalanceSeries(monthEnds),
      getTotalCardDebt(asOf),
      Promise.all(monthEnds.map((d) => getTotalCardDebt(d))),
      getDueStatements(today, 30),
      getBudgetUsage(month),
      getInsights(month, today),
    ]);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Bem-vindo ao Meu Financeiro" description="Vamos começar pelo básico." />
        <Card>
          <EmptyState
            icon={<WalletCards />}
            title="Cadastre suas contas"
            description="Informe suas contas (corrente, digital, dinheiro, poupança…) e o saldo inicial de cada uma. A partir daí, todo saldo é calculado automaticamente."
            action={
              <Button asChild>
                <Link href="/contas?nova=1">Cadastrar primeira conta</Link>
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const summary = summarize(entries, range, regime);
  const prev = summarize(entries, monthRange(shiftMonth(month, -1)), regime);
  const overview = computeOverview(accounts, balances, debt);
  const flow = monthlySeries(entries, months, regime).map((p) => ({
    label: formatMonthShort(p.month),
    income: p.income,
    expense: p.expense,
  }));
  const wealth = series.map((s, i) => {
    const o = computeOverview(accounts, s.rows, debts[i]);
    return { label: formatMonthShort(months[i]), netWorth: o.netWorth, reserved: o.reserved };
  });
  const operationalCount = accounts.filter((a) => a.isOperational && !a.archived).length;
  const hasHistory = entries.length > 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          regime === "caixa"
            ? "Visão de caixa: o que efetivamente entrou e saiu."
            : "Visão por competência: pela data dos lançamentos, incluindo pendentes."
        }
        actions={
          <>
            <RegimeToggle regime={regime} base="/" params={params} />
            <MonthNav month={month} base="/" params={params} current={currentMonth} />
          </>
        }
      />

      {overview.overAllocatedAccountIds.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            Você tem mais dinheiro reservado do que saldo em{" "}
            {overview.overAllocatedAccountIds.map((id) => accounts.find((a) => a.id === id)?.name).join(", ")}. Registre
            uma retirada da reserva ou revise os lançamentos.{" "}
            <Link href="/reservas" className="font-medium underline">
              Ver reservas
            </Link>
          </p>
        </div>
      )}

      <QuickAddBar />
      <BudgetAlerts usage={budgetUsage} categories={categories} month={month} />

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Saldo disponível"
          cents={overview.available}
          highlight
          className="col-span-2 lg:col-span-1"
          hint={`${operationalCount} ${operationalCount === 1 ? "conta operacional" : "contas operacionais"} · sem reservas`}
        />
        <Stat
          label={regime === "caixa" ? "Receitas recebidas" : "Receitas do mês"}
          cents={summary.income}
          previous={prev.income}
          goodWhen="up"
          tone="positive"
          hint={summary.pendingIncome > 0 ? `· inclui ${brl(summary.pendingIncome)} a receber` : undefined}
        />
        <Stat
          label="Despesas do mês"
          cents={summary.expense}
          previous={prev.expense}
          goodWhen="down"
          tone="negative"
          hint={summary.pendingExpense > 0 ? `· inclui ${brl(summary.pendingExpense)} a pagar` : undefined}
        />
        <Stat label="Resultado mensal" cents={summary.result} previous={prev.result} goodWhen="up" tone="auto" />
        <Stat label="Reservas financeiras" cents={overview.reserved} hint={<Link href="/reservas" className="hover:underline">ver metas</Link>} />
        <Stat
          label="Patrimônio líquido"
          cents={overview.netWorth}
          hint={debt > 0 ? `contas − ${brl(debt)} em cartões` : "contas − dívidas"}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5 [&>*]:min-w-0">
        <Card className="lg:col-span-3">
          <CardHeader title="Receitas × despesas" description="Últimos 6 meses" />
          <CardBody>
            {hasHistory ? (
              <BarsChart
                caption="Receitas e despesas nos últimos 6 meses"
                data={flow}
                series={[
                  { key: "income", label: "Receitas", color: "var(--chart-income)" },
                  { key: "expense", label: "Despesas", color: "var(--chart-expense)" },
                ]}
              />
            ) : (
              <EmptyState icon={<Inbox />} title="Ainda sem lançamentos" description="Seus primeiros registros aparecem aqui." action={<NewEntryButton size="sm" />} />
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Gastos por categoria" description={formatMonthLong(month)} />
          <CardBody>
            {summary.expense > 0 ? (
              <CategoryBreakdown byCategory={summary.expenseByCategory} categories={[...categories, CARD_PAYMENT_PSEUDO_CATEGORY]} />
            ) : (
              <EmptyState icon={<PieChart />} title="Nenhuma despesa neste mês" />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader
            title="Próximos vencimentos"
            description="Pendentes vencidos e dos próximos 30 dias"
            action={
              <Link href="/planejamento" className="text-xs font-medium text-brand hover:underline">
                Ver todos
              </Link>
            }
          />
          <div className="pb-2 pt-2">
            {dueStatements.length > 0 && <DueStatementsList items={dueStatements.slice(0, 4)} />}
            {upcoming.length ? (
              <EntryList items={upcoming.map((t) => ({ kind: "transaction" as const, t }))} />
            ) : dueStatements.length ? null : (
              <EmptyState icon={<CalendarClock />} title="Nada pendente" description="Contas a pagar e a receber aparecem aqui." />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Últimas movimentações"
            action={
              <Link href="/movimentacoes" className="text-xs font-medium text-brand hover:underline">
                Ver todas
              </Link>
            }
          />
          <div className="pb-2 pt-2">
            {recent.length ? (
              <EntryList items={recent.map((t) => ({ kind: "transaction" as const, t }))} />
            ) : (
              <EmptyState icon={<Inbox />} title="Nenhuma movimentação" action={<NewEntryButton size="sm" />} />
            )}
          </div>
        </Card>
      </div>

      {hasHistory && (
        <Card className="mt-4">
          <CardHeader
            title="Insights do mês"
            action={<Link href={month === monthKeyOf(today) ? "/relatorios" : `/relatorios?m=${month}`} className="text-xs font-medium text-brand hover:underline">Relatórios</Link>}
          />
          <CardBody>
            <InsightsList items={insights.slice(0, 3)} />
          </CardBody>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Patrimônio e reservas" description="Fechamento de cada mês. As reservas já estão contidas no patrimônio." />
        <CardBody>
          <LinesChart
            caption="Patrimônio líquido e reservas nos últimos 6 meses"
            data={wealth}
            series={[
              { key: "netWorth", label: "Patrimônio líquido", color: "var(--chart-networth)" },
              { key: "reserved", label: "Reservas", color: "var(--chart-reserves)" },
            ]}
          />
        </CardBody>
      </Card>
      {savings.goals.length === 0 && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Dica: crie uma <Link href="/reservas" className="underline">reserva</Link> para separar dinheiro com objetivo.
        </p>
      )}
    </>
  );
}

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
