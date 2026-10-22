import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Money } from "./money";
import { percentChange } from "@/lib/finance/summary";
import { cn } from "@/lib/utils";

/**
 * Indicador com comparação ao mês anterior.
 * `goodWhen` define se subir é bom (receitas) ou ruim (despesas).
 */
export function Stat({
  label,
  cents,
  previous,
  goodWhen = "up",
  hint,
  tone = "none",
  highlight = false,
  className,
}: {
  label: string;
  cents: number;
  previous?: number;
  goodWhen?: "up" | "down";
  hint?: React.ReactNode;
  tone?: "none" | "auto" | "positive" | "negative";
  highlight?: boolean;
  className?: string;
}) {
  const change = previous === undefined ? null : percentChange(cents, previous);
  const up = change !== null && change > 0;
  const good = change === null || change === 0 ? null : goodWhen === "up" ? up : !up;
  return (
    <Card className={cn("flex flex-col gap-2 p-4 md:p-5", highlight && "bg-primary text-primary-foreground", className)}>
      <span className={cn("text-xs font-medium", highlight ? "opacity-70" : "text-muted-foreground")}>{label}</span>
      <Money cents={cents} tone={highlight ? "none" : tone} className="text-xl font-semibold tracking-tight md:text-2xl" />
      <div className={cn("flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-xs", highlight ? "opacity-70" : "text-muted-foreground")}>
        {change !== null && Math.abs(change) >= 0.5 && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              !highlight && good === true && "text-positive",
              !highlight && good === false && "text-negative",
            )}
            title="Comparado ao mês anterior"
          >
            {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
            <span className="sr-only">{up ? "acima" : "abaixo"} do mês anterior</span>
          </span>
        )}
        {previous !== undefined && change === null && cents !== 0 && <span>sem base no mês anterior</span>}
        {previous !== undefined && change !== null && Math.abs(change) >= 0.5 && <span>vs. mês anterior</span>}
        {hint}
      </div>
    </Card>
  );
}
