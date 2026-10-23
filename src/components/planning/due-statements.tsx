import Link from "next/link";
import { Badge } from "@/components/ui/card";
import { Money } from "@/components/common/money";
import { CardIcon } from "@/app/(app)/cartoes/card-forms";
import { formatDateBR, formatDayMonth, todayISO } from "@/lib/finance/dates";
import { statementState } from "@/lib/finance/cards";
import type { DueStatement } from "@/lib/data/planning";

/** Faturas de cartão a pagar, em formato de lista igual às movimentações. */
export function DueStatementsList({ items, showDate = true }: { items: DueStatement[]; showDate?: boolean }) {
  const today = todayISO();
  return (
    <ul className="divide-y">
      {items.map(({ totals, card, remaining, overdue }) => (
        <li key={totals.statementId}>
          <Link href={`/cartoes/${card.id}?m=${totals.month}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50">
            <CardIcon color={card.color} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">Fatura {card.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {showDate && <span className="tabular">{formatDayMonth(totals.dueDate)} · </span>}
                {statementState(totals, today) === "open" ? "Ainda aberta" : "Fechada"} · vence {formatDateBR(totals.dueDate)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Money cents={-remaining} tone="negative" className="text-sm font-semibold" />
              <Badge tone={overdue ? "negative" : "warning"}>{overdue ? "Vencida" : "A pagar"}</Badge>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
