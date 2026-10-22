import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonthLong, shiftMonth, type MonthKey } from "@/lib/finance/dates";
import { cn } from "@/lib/utils";

type Params = Record<string, string | undefined>;

export function hrefWith(base: string, params: Params, patch: Params) {
  const merged = { ...params, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

/** Navegação entre meses (links, sem JavaScript no cliente). */
export function MonthNav({
  month,
  base,
  params,
  current,
}: {
  month: MonthKey;
  base: string;
  params: Params;
  current: MonthKey;
}) {
  const btn = "flex size-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl border bg-card p-1">
      <Link href={hrefWith(base, params, { m: shiftMonth(month, -1) })} className={btn} aria-label="Mês anterior" scroll={false}>
        <ChevronLeft className="size-4" />
      </Link>
      <span className="min-w-36 text-center text-sm font-medium tabular">{formatMonthLong(month)}</span>
      <Link href={hrefWith(base, params, { m: shiftMonth(month, 1) })} className={btn} aria-label="Próximo mês" scroll={false}>
        <ChevronRight className="size-4" />
      </Link>
      {month !== current && (
        <Link
          href={hrefWith(base, params, { m: undefined })}
          className="ml-1 rounded-lg px-2 py-1.5 text-xs font-medium text-brand hover:bg-muted"
          scroll={false}
        >
          Hoje
        </Link>
      )}
    </div>
  );
}

export function RegimeToggle({ regime, base, params }: { regime: string; base: string; params: Params }) {
  const opts = [
    { v: "competencia", label: "Competência", title: "Pela data do lançamento, incluindo pendentes" },
    { v: "caixa", label: "Caixa", title: "Pelo que efetivamente entrou e saiu" },
  ];
  return (
    <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Regime">
      {opts.map((o) => (
        <Link
          key={o.v}
          href={hrefWith(base, params, { r: o.v === "competencia" ? undefined : o.v })}
          title={o.title}
          scroll={false}
          aria-current={regime === o.v ? "true" : undefined}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition",
            regime === o.v ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
