import Link from "next/link";
import { Download, TriangleAlert } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { hrefWith, MonthNav, RegimeToggle } from "@/components/common/month-nav";
import { Money } from "@/components/common/money";
import { BarsChart, LinesChart } from "@/components/charts/charts";
import { CategoryBreakdown } from "@/components/common/category-breakdown";
import { InsightsList } from "@/components/common/insights-list";
import { getEntriesInRange } from "@/lib/data/entries";
import { getInsights, getProjection } from "@/lib/data/insights";
import { getAccounts, getBalanceSeries, getCategories, getTotalCardDebt } from "@/lib/data/queries";
import {
  formatDateBR, formatDayMonth, formatMonthLong, formatMonthShort, lastMonths, monthKeyOf, monthRange, parseMonthParam, shiftMonth, todayISO,
} from "@/lib/finance/dates";
import { computeOverview } from "@/lib/finance/overview";
import { averageOf, categoryByMonth, fixedVsVariable } from "@/lib/finance/reports";
import { isRegime, monthlySeries, percentChange, savingsRate, summarize } from "@/lib/finance/summary";
import { CARD_PAYMENT_PSEUDO_CATEGORY } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Relatórios" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const PERIODS = [3, 6, 12, 24] as const;

export default async function RelatoriosPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = todayISO();
  const current = monthKeyOf(today);
  const month = parseMonthParam(sp.m, today);
  const regime = isRegime(sp.r) ? sp.r : "competencia";
  const pNum = Number(sp.p);
  const period = (PERIODS as readonly number[]).includes(pNum) ? pNum : 6;
  const months = lastMonths(month, period);
  const from = monthRange(months[0]).from;
  const to = monthRange(month).to;
  const params = {
    m: month === current ? undefined : month,
    r: regime === "competencia" ? undefined : regime,
    p: period === 6 ? undefined : String(period),
  };

  const monthEnds = months.map((m) => {
    const end = monthRange(m).to;
    return end < today ? end : today;
  }).filter((d) => d >= from && d <= (to < today ? to : today));

  const [entries, categories, accounts, balanceSeries, debts, insights, projection] = await Promise.all([
    // um mês a mais antes do período, para a comparação do primeiro mês
    getEntriesInRange(monthRange(shiftMonth(months[0], -1)).from, to),
    getCategories(),
    getAccounts(),
    getBalanceSeries(monthEnds),
    Promise.all(monthEnds.map((d) => getTotalCardDebt(d))),
    getInsights(month, today),
    getProjection(today),
  ]);

  const cats = [...categories, CARD_PAYMENT_PSEUDO_CATEGORY];
  const series = monthlySeries(entries, months, regime);
  const withData = series.filter((p) => p.income || p.expense);
  const totals = series.reduce((a, p) => ({ income: a.income + p.income, expense: a.expense + p.expense }), { income: 0, expense: 0 });
  const result = totals.income - totals.expense;
  const rate = savingsRate({ income: totals.income, result });
  const avgExpense = averageOf(series.map((p) => p.expense));
  const periodSummary = summarize(entries, { from, to }, regime);

  // comparação mês a mês por categoria (mês selecionado × anterior)
  const prevMonth = shiftMonth(month, -1);
  const byCat = categoryByMonth(entries, [prevMonth, month], regime);
  const comparison = [...byCat.entries()]
    .map(([id, [prev, cur]]) => ({ id, name: cats.find((c) => c.id === id)?.name ?? "Sem categoria", prev, cur, change: percentChange(cur, prev) }))
    .filter((r) => r.prev || r.cur)
    .sort((a, b) => Math.max(b.cur, b.prev) - Math.max(a.cur, a.prev));
  const cmpTotal = comparison.reduce((a, r) => ({ prev: a.prev + r.prev, cur: a.cur + r.cur }), { prev: 0, cur: 0 });

  const fixedIds = new Set(categories.filter((c) => c.isFixed).map((c) => c.id));
  const fv = fixedVsVariable(entries, months, fixedIds);
  const hasFixed = fixedIds.size > 0;

  const wealth = balanceSeries.map((s, i) => {
    const o = computeOverview(accounts, s.rows, debts[i]);
    return { label: formatMonthShort(monthKeyOf(s.date)), netWorth: o.netWorth, reserved: o.reserved, debts: debts[i] };
  });
  const hasDebt = debts.some((d) => d > 0);

  const projData = projection.points.map((p) => ({ label: formatDayMonth(p.date), balance: p.balance }));
  const csvHref = `/api/export?formato=csv&de=${from}&ate=${to}`;
  const periodLabel = period === 1 ? formatMonthLong(month) : `${formatMonthShort(months[0])} – ${formatMonthShort(month)}`;

  return (
    <>
      <PageHeader
        title="Relatórios"
        description={`${periodLabel} · cartões incluídos (parcelas na competência, faturas no caixa).`}
        actions={
          <Button asChild variant="outline" size="sm">
            <a href={csvHref} download>
              <Download className="size-4" /> CSV do período
            </a>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <MonthNav month={month} base="/relatorios" params={params} current={current} />
        <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={hrefWith("/relatorios", params, { p: p === 6 ? undefined : String(p) })}
              scroll={false}
              aria-current={period === p ? "true" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                period === p ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}m
            </Link>
          ))}
        </div>
        <RegimeToggle regime={regime} base="/relatorios" params={params} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Insights" description={`Calculados a partir dos seus dados de ${formatMonthLong(month).toLowerCase()}.`} />
        <CardBody>
          <InsightsList items={insights} />
        </CardBody>
      </Card>

      {withData.length === 0 ? (
        <Card>
          <EmptyState title="Sem lançamentos neste período" description="Os relatórios aparecem assim que houver lançamentos. Nenhuma conclusão é mostrada sem dados." />
        </Card>
      ) : (
        <>
          <section aria-label="Resumo do período" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Receitas" cents={totals.income} />
            <Kpi label="Despesas" cents={totals.expense} />
            <Kpi label="Resultado" cents={result} tone />
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Taxa de poupança</p>
              <p className="tabular text-lg font-semibold">{rate == null ? "—" : `${rate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</p>
            </Card>
            <Card className="col-span-2 p-4 lg:col-span-1">
              <p className="text-xs text-muted-foreground">Despesa média mensal</p>
              {avgExpense == null ? <p className="text-lg font-semibold">—</p> : <Money cents={avgExpense} className="text-lg font-semibold" />}
              <p className="text-[11px] text-muted-foreground">
                em {withData.length} {withData.length === 1 ? "mês" : "meses"} com dados
              </p>
            </Card>
          </section>

          <Card>
            <CardHeader title="Receitas × despesas por mês" />
            <CardBody>
              <BarsChart
                caption={`Receitas e despesas, ${periodLabel}`}
                data={series.map((p) => ({ label: formatMonthShort(p.month), income: p.income, expense: p.expense }))}
                series={[
                  { key: "income", label: "Receitas", color: "var(--chart-income)" },
                  { key: "expense", label: "Despesas", color: "var(--chart-expense)" },
                ]}
              />
            </CardBody>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader title="Gastos por categoria" description={`Total do período (${periodLabel}).`} />
              <CardBody>
                {periodSummary.expenseByCategory.size ? (
                  <CategoryBreakdown byCategory={periodSummary.expenseByCategory} categories={cats} limit={8} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma despesa no período.</p>
                )}
              </CardBody>
            </Card>

            <Card className="min-w-0">
              <CardHeader
                title="Fixas × variáveis"
                description={hasFixed ? "Pela marcação “fixa” de cada categoria." : "Marque categorias como fixas em Configurações para separar."}
              />
              <CardBody>
                <BarsChart
                  caption="Despesas fixas e variáveis por mês"
                  data={fv.map((r) => ({ label: formatMonthShort(r.month), fixed: r.fixed, variable: r.variable }))}
                  series={[
                    { key: "fixed", label: "Fixas", color: "var(--chart-fixed)" },
                    { key: "variable", label: "Variáveis", color: "var(--chart-variable)" },
                  ]}
                  height={220}
                />
              </CardBody>
            </Card>
          </div>

          <Card className="mt-4 overflow-x-auto">
            <CardHeader title="Comparação de meses" description={`${formatMonthLong(prevMonth)} × ${formatMonthLong(month)}, por categoria.`} />
            {comparison.length ? (
              <table className="mt-3 w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-y text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Categoria</th>
                    <th className="px-3 py-2.5 text-right font-medium">{formatMonthShort(prevMonth)}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{formatMonthShort(month)}</th>
                    <th className="px-5 py-2.5 text-right font-medium">Variação</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {comparison.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-2.5">{r.name}</td>
                      <td className="px-3 py-2.5 text-right"><Money cents={r.prev} /></td>
                      <td className="px-3 py-2.5 text-right"><Money cents={r.cur} /></td>
                      <td className="px-5 py-2.5 text-right"><Change value={r.change} /></td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="px-5 py-2.5">Total</td>
                    <td className="px-3 py-2.5 text-right"><Money cents={cmpTotal.prev} /></td>
                    <td className="px-3 py-2.5 text-right"><Money cents={cmpTotal.cur} /></td>
                    <td className="px-5 py-2.5 text-right"><Change value={percentChange(cmpTotal.cur, cmpTotal.prev)} /></td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <CardBody>
                <p className="text-sm text-muted-foreground">Sem despesas nesses dois meses.</p>
              </CardBody>
            )}
            {month === current && comparison.length > 0 && (
              <p className="px-5 pb-4 pt-2 text-[11px] text-muted-foreground">O mês atual ainda está em andamento.</p>
            )}
          </Card>

          <Card className="mt-4 overflow-x-auto">
            <CardHeader title="Mês a mês" />
            <table className="mt-3 w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-y text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Mês</th>
                  <th className="px-3 py-2.5 text-right font-medium">Receitas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Despesas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Resultado</th>
                  <th className="px-5 py-2.5 text-right font-medium">Poupança</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {/* meses antes do primeiro lançamento não entram na tabela */}
                {series.slice(Math.max(0, series.findIndex((p) => p.income || p.expense))).reverse().map((p) => {
                  const r = savingsRate({ income: p.income, result: p.result });
                  return (
                    <tr key={p.month}>
                      <td className="px-5 py-2.5">{formatMonthLong(p.month)}</td>
                      <td className="px-3 py-2.5 text-right"><Money cents={p.income} /></td>
                      <td className="px-3 py-2.5 text-right"><Money cents={p.expense} /></td>
                      <td className="px-3 py-2.5 text-right font-medium"><Money cents={p.result} tone="auto" /></td>
                      <td className="tabular px-5 py-2.5 text-right text-muted-foreground">{r == null ? "—" : `${Math.round(r)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {wealth.length > 0 && accounts.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Evolução do patrimônio e das reservas"
            description="Fechamento de cada mês. Patrimônio = saldos − dívida de cartão (inclui parcelas futuras)."
          />
          <CardBody>
            <LinesChart
              caption="Patrimônio líquido, reservas e dívida de cartão por mês"
              data={wealth}
              series={[
                { key: "netWorth", label: "Patrimônio líquido", color: "var(--chart-networth)" },
                { key: "reserved", label: "Reservas", color: "var(--chart-reserves)" },
                ...(hasDebt ? [{ key: "debts", label: "Dívida de cartão", color: "var(--chart-expense)" }] : []),
              ]}
            />
          </CardBody>
        </Card>
      )}

      {accounts.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Projeção do saldo disponível"
            description={`De hoje até ${formatDateBR(projection.until)}: contas a pagar/receber pendentes e faturas em aberto, nas contas do dia a dia.`}
          />
          <CardBody>
            <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Hoje</p>
                <Money cents={projection.start} className="font-semibold" tone="auto" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Menor saldo</p>
                <Money cents={projection.min.balance} className="font-semibold" tone="auto" />
                <p className="text-[11px] text-muted-foreground">{formatDateBR(projection.min.date)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Em {formatDateBR(projection.until)}</p>
                <Money cents={projection.end} className="font-semibold" tone="auto" />
              </div>
            </div>
            {projection.firstNegative && (
              <p className="mb-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                O saldo disponível fica negativo em {formatDateBR(projection.firstNegative.date)}.
              </p>
            )}
            <LinesChart
              caption="Saldo disponível previsto por dia"
              xLabel="Dia"
              data={projData}
              dots={false}
              zeroLine={projection.min.balance < 0}
              series={[{ key: "balance", label: "Saldo previsto", color: "var(--chart-income)" }]}
            />
            {projection.items.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Nenhum lançamento pendente previsto: a linha fica estável.</p>
            )}
          </CardBody>
        </Card>
      )}
    </>
  );
}

function Kpi({ label, cents, tone }: { label: string; cents: number; tone?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Money cents={cents} className="text-lg font-semibold" tone={tone ? "auto" : undefined} />
    </Card>
  );
}

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">novo</span>;
  const v = Math.round(value);
  if (v === 0) return <span className="tabular text-muted-foreground">0%</span>;
  // despesa subindo é ruim (vermelho), caindo é bom (verde)
  return <span className={cn("tabular font-medium", v > 0 ? "text-negative" : "text-positive")}>{v > 0 ? "+" : ""}{v}%</span>;
}
