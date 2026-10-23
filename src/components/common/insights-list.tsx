import { Lightbulb, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import type { Insight } from "@/lib/finance/insights";
import { cn } from "@/lib/utils";

const ICON = { positive: TrendingDown, negative: TrendingUp, warning: TriangleAlert, neutral: Lightbulb };
const TONE = {
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-accent text-accent-foreground",
};

export function InsightsList({ items }: { items: Insight[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2">
      {items.map((i) => {
        const Icon = ICON[i.tone];
        return (
          <li key={i.id} className="flex items-start gap-3 text-sm">
            <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg", TONE[i.tone])}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="leading-relaxed">{i.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
