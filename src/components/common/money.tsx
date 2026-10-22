import { formatBRL } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

/** Valor monetário com sinal e cor consistentes. */
export function Money({
  cents,
  tone = "none",
  sign = false,
  className,
}: {
  cents: number;
  /** auto: verde se > 0, vermelho se < 0 */
  tone?: "none" | "auto" | "positive" | "negative" | "muted";
  sign?: boolean;
  className?: string;
}) {
  const color =
    tone === "auto"
      ? cents > 0
        ? "text-positive"
        : cents < 0
          ? "text-negative"
          : ""
      : tone === "positive"
        ? "text-positive"
        : tone === "negative"
          ? "text-negative"
          : tone === "muted"
            ? "text-muted-foreground"
            : "";
  const text = sign && cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents);
  return <span className={cn("tabular whitespace-nowrap", color, className)}>{text}</span>;
}
