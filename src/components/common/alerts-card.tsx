import Link from "next/link";
import { BellRing, ChevronRight, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import type { AlertItem } from "@/lib/finance/alerts";
import { cn } from "@/lib/utils";

const ICON = { danger: CircleAlert, warning: TriangleAlert, info: Info };
const TONE = {
  danger: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
  info: "bg-accent text-accent-foreground",
};

/** Avisos do dia no início — os mesmos que chegam como notificação às 9h. */
export function AlertsCard({ alerts, devices }: { alerts: AlertItem[]; devices: number }) {
  if (!alerts.length) return null;
  return (
    <Card className="mb-4 pb-2">
      <CardHeader
        title="Avisos"
        description="Vencimentos e saldo dos próximos dias."
        action={
          devices === 0 ? (
            <Link href="/configuracoes" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <BellRing className="size-3.5" aria-hidden /> Receber no celular
            </Link>
          ) : undefined
        }
      />
      <ul className="mt-2 grid grid-cols-1 divide-y">
        {alerts.map((a) => {
          const Icon = ICON[a.severity];
          return (
            <li key={a.key}>
              <Link href={a.url} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/50">
                <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg", TONE[a.severity])}>
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{a.body}</span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
