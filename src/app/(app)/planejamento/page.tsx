import Link from "next/link";
import { CalendarCheck, CreditCard, Repeat, Target } from "lucide-react";
import { Card, CardHeader, EmptyState, Progress } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Money } from "@/components/common/money";
import { MonthNav } from "@/components/common/month-nav";
import { EntryList } from "@/components/entry/entry-list";
import { DynamicIcon } from "@/components/icon";
import { DueStatementsList } from "@/components/planning/due-statements";
import { getAccounts, getCards, getCategories, getNextOccurrences, getRecurringRules, getUpcoming } from "@/lib/data/queries";
import { getBudgetUsage, getDueStatements } from "@/lib/data/planning";
import { addDays, formatDateBR, monthKeyOf, parseMonthParam, todayISO } from "@/lib/finance/dates";
import { repeatLabel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BudgetActions, CopyBudgetsButton, EndRecurringButton, NewBudgetButton } from "./planning-forms";

export const metadata = { title: "Planejamento" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const WINDOWS = [7, 15, 30] as const;

export default async function PlanejamentoPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const today = todayISO();
  const currentMonth = monthKeyOf(today);
  const month = parseMonthParam(sp.m, today);
  const days = WINDOWS.find((d) => String(d) === sp.dias) ?? 30;

  const [categories, accounts, cards, usage, upcoming, due, rules, next] = await Promise.all([
    getCategories(),
    getAccounts(),
    getCards(),
    getBudgetUsage(month),
    getUpcoming(today, days, 500),
    getDueStatements(today, days),
    getRecurringRules(),
    getNextOccurrences(today),
  ]);

  const overdue = upcoming.filter((t) => t.date < today);
  const nextItems = upcoming.filter((t) => t.date >= today);
  const toPay = upcoming.filter((t) => t.type === "expense").reduce((a, t) => a + t.amountCents, 0) + due.reduce((a, d) => a + d.remaining, 0);
  const toReceive = upcoming.filter((t) => t.type === "income").reduce((a, t) => a + t.amountCents, 0);

  const totalLimit = usage.reduce((a, u) => a + u.status.limit, 0);
  const totalSpent = usage.reduce((a, u) => a + u.status.spent, 0);
  const cat = (id: string) => categories.find((c) => c.id === id);
  const activeRules = rules.filter((r) => !r.endDate || r.endDate >= today);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { m: month === currentMonth ? undefined : month, dias: days === 30 ? undefined : String(days), ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/planejamento?${s}` : "/planejamento";
  };

  return (
    <>
      <PageHeader title="Planejamento" description="Orçamentos do mês, contas a vencer e lançamentos que se repetem." />

      {/* --------------------------- Orçamentos --------------------------- */}
      <section aria-labelledby="orcamentos">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="orcamentos" className="flex items-center gap-2 text-base font-semibold">
            <Target className="size-4 text-muted-foreground" /> Orçamentos
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <MonthNav month={month} base="/planejamento" params={{ dias: days === 30 ? undefined : String(days) }} current={currentMonth} />
          </div>
        </div>
        <Card className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div>
              <p className="text-xs text-muted-foreground">Consumido / limite do mês (competência, inclui cartão)</p>
              <p className="text-lg font-semibold">
                <Money cents={totalSpent} /> <span className="text-sm font-normal text-muted-foreground">de</span> <Money cents={totalLimit} />
              </p>
            </div>
            <div className="flex gap-2">
              {usage.length > 0 && <CopyBudgetsButton month={month} />}
              <NewBudgetButton month={month} categories={categories} usedCategoryIds={usage.map((u) => u.budget.categoryId)} />
            </div>
          </div>
          {usage.length === 0 ? (
            <EmptyState
              icon={<Target />}
              title="Nenhum orçamento neste mês"
              description="Defina limites por categoria (ex.: Alimentação R$ 1.200). Os gastos no cartão contam pela parcela do mês."
            />
          ) : (
            <ul className="mt-3 divide-y">
              {usage.map(({ budget, status }) => {
                const c = cat(budget.categoryId);
                const color = status.level === "over" ? "var(--negative)" : status.level === "warning" ? "var(--warning)" : "var(--positive)";
                return (
                  <li key={budget.id} className="grid grid-cols-1 gap-2 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <DynamicIcon name={c?.icon ?? "tag"} className="size-4 text-muted-foreground" />
                      <span className="flex-1 truncate text-sm font-medium">{c?.name ?? "Categoria"}</span>
                      <span
                        className={cn(
                          "tabular text-xs font-semibold",
                          status.level === "over" ? "text-negative" : status.level === "warning" ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {Math.round(status.percent)}%
                      </span>
                      <BudgetActions id={budget.id} month={month} categories={categories} categoryId={budget.categoryId} amountCents={budget.amountCents} />
                    </div>
                    <Progress value={status.percent} color={color} />
                    <div className="flex flex-wrap justify-between gap-x-4 text-xs text-muted-foreground">
                      <span>
                        Gasto <Money cents={status.spent} /> de <Money cents={status.limit} />
                      </span>
                      <span className={status.available < 0 ? "font-medium text-negative" : ""}>
                        {status.available < 0 ? "Passou " : "Disponível "}
                        <Money cents={Math.abs(status.available)} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {/* --------------------------- Vencimentos -------------------------- */}
      <section aria-labelledby="vencimentos" className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="vencimentos" className="flex items-center gap-2 text-base font-semibold">
            <CalendarCheck className="size-4 text-muted-foreground" /> Contas a vencer
            <span className="text-xs font-normal text-muted-foreground">até {formatDateBR(addDays(today, days))}</span>
          </h2>
          <div className="inline-flex rounded-xl bg-muted p-1">
            {WINDOWS.map((d) => (
              <Link
                key={d}
                href={qs({ dias: d === 30 ? undefined : String(d) })}
                scroll={false}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", d === days ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {d} dias
              </Link>
            ))}
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-md">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">A pagar (inclui faturas)</p>
            <Money cents={toPay} tone="negative" className="text-lg font-semibold" />
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">A receber</p>
            <Money cents={toReceive} tone="positive" className="text-lg font-semibold" />
          </Card>
        </div>
        {due.length > 0 && (
          <Card className="mb-3">
            <CardHeader title="Faturas de cartão" description="Saldo ainda não pago de cada fatura" />
            <div className="py-2">
              <DueStatementsList items={due} />
            </div>
          </Card>
        )}
        {overdue.length > 0 && (
          <Card className="mb-3 border-negative/40">
            <CardHeader title="Vencidos" description="Pendentes com data anterior a hoje" />
            <div className="py-2">
              <EntryList items={overdue.map((t) => ({ kind: "transaction" as const, t }))} />
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Próximos" />
          <div className="py-2">
            {nextItems.length ? (
              <EntryList items={nextItems.map((t) => ({ kind: "transaction" as const, t }))} />
            ) : (
              <EmptyState icon={<CalendarCheck />} title="Nada previsto neste período" description="Lance contas como “A pagar” / “A receber” ou crie lançamentos que se repetem." />
            )}
          </div>
        </Card>
      </section>

      {/* -------------------------- Recorrências -------------------------- */}
      <section aria-labelledby="recorrencias" className="mt-8">
        <h2 id="recorrencias" className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Repeat className="size-4 text-muted-foreground" /> Lançamentos que se repetem
        </h2>
        <Card className="pb-2">
          {activeRules.length === 0 ? (
            <EmptyState
              icon={<Repeat />}
              title="Nenhuma recorrência"
              description="No novo lançamento, abra “Repetir, observações e mais” e escolha a frequência (salário, aluguel, assinaturas…)."
            />
          ) : (
            <ul className="divide-y pt-2">
              {activeRules.map((r) => {
                const c = cat(r.categoryId);
                const dest = r.cardId ? cards.find((x) => x.id === r.cardId)?.name : accounts.find((x) => x.id === r.accountId)?.name;
                const nextDate = next.get(r.id);
                return (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <span
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: `color-mix(in oklab, ${c?.color ?? "#64748b"} 14%, transparent)`, color: c?.color ?? "#64748b" }}
                    >
                      {r.cardId ? <CreditCard className="size-[18px]" /> : <DynamicIcon name={c?.icon ?? "tag"} className="size-[18px]" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.description}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {repeatLabel(r.frequency, r.intervalCount)} · {dest ?? "—"}
                        {nextDate ? ` · próxima ${formatDateBR(nextDate)}` : ""}
                        {r.endDate ? ` · até ${formatDateBR(r.endDate)}` : ""}
                      </p>
                    </div>
                    <Money cents={r.type === "expense" ? -r.amountCents : r.amountCents} tone={r.type === "expense" ? "negative" : "positive"} sign className="text-sm font-semibold" />
                    <EndRecurringButton ruleId={r.id} from={nextDate ?? addDays(today, 1)} description={r.description} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">
          As próximas ocorrências ficam previstas (sem marcar como pagas) até o fim do mês seguinte. No cartão, a cobrança é lançada na data de cada repetição.
          Para mudar valor ou data, edite um lançamento da série e escolha “Este e os próximos”.
        </p>
      </section>
    </>
  );
}
