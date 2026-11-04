import Link from "next/link";
import { CreditCard, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/common/money";
import { formatDateBR, formatMonthLong, type MonthKey } from "@/lib/finance/dates";
import type { MonthPayables } from "@/lib/finance/payables";
import { cn } from "@/lib/utils";

/** Total que precisa ser pago no mês: contas + faturas de cartão que vencem no mês. */
export function MonthPayablesCard({ data, month }: { data: MonthPayables; month: MonthKey }) {
  if (data.total === 0) return null;
  const pct = data.total ? Math.round((data.paid / data.total) * 100) : 0;
  const monthName = formatMonthLong(month).split(" de ")[0].toLowerCase();
  return (
    <Card className="mt-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Total a pagar em {monthName} · contas + faturas de cartão</p>
          <Money cents={data.total} className="text-2xl font-semibold" />
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>
            Já pago <Money cents={data.paid} className="font-medium text-foreground" />
          </p>
          <p>
            Falta pagar <Money cents={data.remaining} className={cn("font-semibold", data.remaining > 0 ? "text-negative" : "text-positive")} />
          </p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-positive" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-2">
        {data.bills.count > 0 && (
          <li className="flex items-center justify-between gap-3 border-b py-2">
            <Link href={`/movimentacoes?m=${month}&tipo=despesa`} className="flex min-w-0 items-center gap-2 hover:underline">
              <Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">
                Contas e despesas das contas <span className="text-xs text-muted-foreground">({data.bills.count})</span>
              </span>
            </Link>
            <span className="shrink-0 text-right">
              <Money cents={data.bills.total} className="font-medium" />
              {data.bills.remaining > 0 && (
                <span className="block text-[11px] text-muted-foreground">
                  falta <Money cents={data.bills.remaining} />
                </span>
              )}
            </span>
          </li>
        )}
        {data.cards.map((c) => (
          <li key={`${c.cardId}-${c.dueDate}`} className="flex items-center justify-between gap-3 border-b py-2">
            <Link href={`/cartoes/${c.cardId}?m=${c.dueDate.slice(0, 7)}`} className="flex min-w-0 items-center gap-2 hover:underline">
              <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">
                Fatura {c.cardName}{" "}
                <span className="text-xs text-muted-foreground">
                  vence {formatDateBR(c.dueDate).slice(0, 5)}
                  {c.open ? " · ainda aberta" : ""}
                </span>
              </span>
            </Link>
            <span className="shrink-0 text-right">
              <Money cents={c.total} className="font-medium" />
              <span className={cn("block text-[11px]", c.remaining === 0 ? "text-positive" : "text-muted-foreground")}>
                {c.remaining === 0 ? "paga" : c.paid > 0 ? <>falta <Money cents={c.remaining} /></> : "em aberto"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
