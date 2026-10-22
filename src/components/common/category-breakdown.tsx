import { DynamicIcon } from "@/components/icon";
import { formatBRL } from "@/lib/finance/money";
import { topCategories } from "@/lib/finance/summary";
import type { Category } from "@/lib/types";

/** Barras horizontais por categoria — mais legível que pizza para comparar valores. */
export function CategoryBreakdown({
  byCategory,
  categories,
  limit = 6,
}: {
  byCategory: Map<string, number>;
  categories: Category[];
  limit?: number;
}) {
  const all = topCategories(byCategory);
  const total = all.reduce((a, c) => a + c.amount, 0);
  const shown = all.slice(0, limit);
  const rest = all.slice(limit).reduce((a, c) => a + c.amount, 0);
  const max = shown[0]?.amount ?? 1;
  const rows = [
    ...shown.map((c) => {
      const cat = categories.find((x) => x.id === c.categoryId);
      return { key: c.categoryId, name: cat?.name ?? "Sem categoria", color: cat?.color ?? "#64748b", icon: cat?.icon ?? "tag", amount: c.amount };
    }),
    ...(rest > 0 ? [{ key: "outras", name: "Outras", color: "#94a3b8", icon: "circle-ellipsis", amount: rest }] : []),
  ];
  return (
    <ul className="grid gap-3.5">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <DynamicIcon name={r.icon} className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{r.name}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="tabular font-medium">{formatBRL(r.amount)}</span>
              <span className="tabular w-9 text-right text-xs text-muted-foreground">
                {total ? Math.round((r.amount / total) * 100) : 0}%
              </span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${Math.max((r.amount / max) * 100, 2)}%`, background: r.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
