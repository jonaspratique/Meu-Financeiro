"use client";

import { Popover as P } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type MultiOption = { value: string; label: string; group?: string };

/**
 * Seletor com várias opções marcáveis. Vazio = "todos".
 * O rótulo mostra a opção escolhida, "Despesas +1" ou "3 selecionadas".
 */
export function MultiSelect({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const selected = options.filter((o) => value.includes(o.value));
  const text =
    selected.length === 0 ? allLabel : selected.length === 1 ? selected[0].label : `${selected[0].label} +${selected.length - 1}`;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const groups: { name?: string; items: MultiOption[] }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.name === o.group);
    if (g) g.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }

  return (
    <P.Root>
      <P.Trigger
        aria-label={label}
        className={cn(fieldClass, "items-center justify-between gap-2 text-left", selected.length > 0 && "border-ring/60")}
      >
        <span className="truncate">{text}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),13rem)] overflow-y-auto rounded-xl border bg-card p-1 text-sm shadow-lg"
        >
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted"
          >
            <Box on={value.length === 0} />
            {allLabel}
          </button>
          <div className="my-1 h-px bg-border" />
          {groups.map((g) => (
            <div key={g.name ?? "_"} role="group" aria-label={g.name}>
              {g.name && <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.name}</p>}
              {g.items.map((o) => {
                const on = value.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted"
                  >
                    <Box on={on} />
                    <span className="truncate">{o.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
    >
      {on && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}
