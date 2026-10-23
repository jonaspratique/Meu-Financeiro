import { Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { RegimeToggle } from "@/components/common/month-nav";
import { Money } from "@/components/common/money";
import { BarsChart } from "@/components/charts/charts";
import { getEntriesInRange } from "@/lib/data/entries";
import { formatMonthLong, formatMonthShort, lastMonths, monthKeyOf, monthRange, todayISO } from "@/lib/finance/dates";
import { isRegime, monthlySeries, savingsRate } from "@/lib/finance/summary";

export const metadata = { title: "Relatórios" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function RelatoriosPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const regime = isRegime(sp.r) ? sp.r : "competencia";
  const today = todayISO();
  const months = lastMonths(monthKeyOf(today), 12);
  const entries = await getEntriesInRange(monthRange(months[0]).from, monthRange(months[11]).to);
  const series = monthlySeries(entries, months, regime);
  const withData = series.filter((p) => p.income || p.expense);
  const avgExpense = withData.length ? Math.round(withData.reduce((a, p) => a + p.expense, 0) / withData.length) : 0;
  const totals = series.reduce((a, p) => ({ income: a.income + p.income, expense: a.expense + p.expense }), { income: 0, expense: 0 });
  const rate = savingsRate({ income: totals.income, result: totals.income - totals.expense });

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Histórico mensal dos últimos 12 meses, incluindo cartões."
        actions={<RegimeToggle regime={regime} base="/relatorios" params={{}} />}
      />
      {withData.length === 0 ? (
        <Card>
          <EmptyState title="Sem histórico ainda" description="Os relatórios aparecem assim que houver lançamentos. Nenhuma conclusão é mostrada sem dados." />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Receitas (12 meses)</p>
              <Money cents={totals.income} className="text-lg font-semibold" />
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Despesas (12 meses)</p>
              <Money cents={totals.expense} className="text-lg font-semibold" />
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Média mensal de despesas</p>
              <Money cents={avgExpense} className="text-lg font-semibold" />
              <p className="text-[11px] text-muted-foreground">em {withData.length} {withData.length === 1 ? "mês" : "meses"} com dados</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Taxa de poupança</p>
              <p className="tabular text-lg font-semibold">{rate == null ? "—" : `${rate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</p>
            </Card>
          </div>
          <Card>
            <CardHeader title="Receitas × despesas por mês" />
            <CardBody>
              <BarsChart
                caption="Receitas e despesas nos últimos 12 meses"
                data={series.map((p) => ({ label: formatMonthShort(p.month), income: p.income, expense: p.expense }))}
                series={[
                  { key: "income", label: "Receitas", color: "var(--chart-income)" },
                  { key: "expense", label: "Despesas", color: "var(--chart-expense)" },
                ]}
              />
            </CardBody>
          </Card>
          <Card className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Mês</th>
                  <th className="px-3 py-3 text-right font-medium">Receitas</th>
                  <th className="px-3 py-3 text-right font-medium">Despesas</th>
                  <th className="px-3 py-3 text-right font-medium">Resultado</th>
                  <th className="px-5 py-3 text-right font-medium">Poupança</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...series].reverse().map((p) => {
                  const r = savingsRate({ income: p.income, result: p.result });
                  return (
                    <tr key={p.month}>
                      <td className="px-5 py-3">{formatMonthLong(p.month)}</td>
                      <td className="px-3 py-3 text-right"><Money cents={p.income} /></td>
                      <td className="px-3 py-3 text-right"><Money cents={p.expense} /></td>
                      <td className="px-3 py-3 text-right font-medium"><Money cents={p.result} tone="auto" /></td>
                      <td className="tabular px-5 py-3 text-right text-muted-foreground">{r == null ? "—" : `${Math.round(r)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
      <Card className="mt-4">
        <EmptyState
          icon={<Sparkles />}
          title="Mais análises na Fase 3"
          description="Gastos por categoria no tempo, fixas × variáveis, projeção de saldo, insights automáticos e exportação CSV avançada."
        />
      </Card>
    </>
  );
}
