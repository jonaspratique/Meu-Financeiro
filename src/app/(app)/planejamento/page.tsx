import Link from "next/link";
import { CalendarCheck, Target } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { Money } from "@/components/common/money";
import { EntryList } from "@/components/entry/entry-list";
import { getUpcoming } from "@/lib/data/queries";
import { addDays, todayISO } from "@/lib/finance/dates";
import { cn } from "@/lib/utils";

export const metadata = { title: "Planejamento" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const WINDOWS = [7, 15, 30] as const;

export default async function PlanejamentoPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const days = WINDOWS.find((d) => String(d) === sp.dias) ?? 30;
  const today = todayISO();
  const upcoming = await getUpcoming(today, days, 500);
  const overdue = upcoming.filter((t) => t.date < today);
  const next = upcoming.filter((t) => t.date >= today);
  const toPay = upcoming.filter((t) => t.type === "expense").reduce((a, t) => a + t.amountCents, 0);
  const toReceive = upcoming.filter((t) => t.type === "income").reduce((a, t) => a + t.amountCents, 0);

  return (
    <>
      <PageHeader
        title="Planejamento"
        description={`Contas previstas até ${addDays(today, days).split("-").reverse().join("/")}.`}
        actions={
          <div className="inline-flex rounded-xl bg-muted p-1">
            {WINDOWS.map((d) => (
              <Link
                key={d}
                href={d === 30 ? "/planejamento" : `/planejamento?dias=${d}`}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", d === days ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {d} dias
              </Link>
            ))}
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">A pagar</p>
          <Money cents={toPay} tone="negative" className="text-lg font-semibold" />
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">A receber</p>
          <Money cents={toReceive} tone="positive" className="text-lg font-semibold" />
        </Card>
      </div>
      {overdue.length > 0 && (
        <Card className="mb-4 border-negative/40">
          <CardHeader title="Vencidos" description="Pendentes com data anterior a hoje" />
          <div className="py-2">
            <EntryList items={overdue.map((t) => ({ kind: "transaction" as const, t }))} />
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Próximos" />
        <div className="py-2">
          {next.length ? (
            <EntryList items={next.map((t) => ({ kind: "transaction" as const, t }))} />
          ) : (
            <EmptyState icon={<CalendarCheck />} title="Nada previsto neste período" description="Lance despesas e receitas como “A pagar” / “A receber” para vê-las aqui." />
          )}
        </div>
      </Card>
      <Card className="mt-4">
        <EmptyState
          icon={<Target />}
          title="Orçamentos por categoria e recorrências — Fase 2"
          description="Limites mensais com alertas de 80% e 100%, cópia para os meses seguintes e lançamentos recorrentes (salário, aluguel, assinaturas)."
        />
      </Card>
    </>
  );
}
