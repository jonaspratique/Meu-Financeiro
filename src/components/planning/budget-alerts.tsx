import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { BudgetUsage } from "@/lib/data/planning";
import type { Category } from "@/lib/types";

/** Aviso quando algum orçamento do mês passou de 80% ou 100%. */
export function BudgetAlerts({ usage, categories, month }: { usage: BudgetUsage[]; categories: Category[]; month: string }) {
  const over = usage.filter((u) => u.status.level === "over");
  const warn = usage.filter((u) => u.status.level === "warning");
  if (!over.length && !warn.length) return null;
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? "Categoria";
  const fmt = (list: BudgetUsage[]) =>
    list.map((u) => `${name(u.budget.categoryId)} (${Math.round(u.status.percent)}%)`).join(", ");
  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
        over.length ? "border-negative/40 bg-negative-soft" : "border-warning/40 bg-warning-soft"
      }`}
    >
      <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${over.length ? "text-negative" : "text-warning"}`} />
      <p>
        {over.length > 0 && (
          <>
            <strong>Orçamento estourado:</strong> {fmt(over)}.{" "}
          </>
        )}
        {warn.length > 0 && (
          <>
            <strong>Acima de 80%:</strong> {fmt(warn)}.{" "}
          </>
        )}
        <Link href={`/planejamento?m=${month}`} className="font-medium underline">
          Ver orçamentos
        </Link>
      </p>
    </div>
  );
}
