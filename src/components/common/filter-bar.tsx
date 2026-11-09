"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import type { Account, Category, CreditCard } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Filtros da lista de movimentações, mantidos na URL (podem ser favoritados). */
export function FilterBar({ accounts, categories, cards = [] }: { accounts: Account[]; categories: Category[]; cards?: CreditCard[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  /** filtros com várias opções ficam na URL separados por vírgula: ?tipo=despesa,receita */
  const list = (key: string) => (sp.get(key) ?? "").split(",").filter(Boolean);
  const setList = (key: string, values: string[]) => set(key, values.join(","));

  useEffect(() => {
    const id = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) set("q", q);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = ["tipo", "status", "conta", "cat", "q"].some((k) => sp.get(k));

  return (
    <div className={cn("grid gap-2 transition-opacity md:grid-cols-[1.4fr_repeat(4,1fr)_auto]", pending && "opacity-60")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Pesquisar descrição…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Pesquisar" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:contents">
        <MultiSelect
          label="Tipo"
          allLabel="Todos os tipos"
          value={list("tipo")}
          onChange={(v) => setList("tipo", v)}
          options={[
            { value: "despesa", label: "Despesas" },
            { value: "receita", label: "Receitas" },
            { value: "transferencia", label: "Transferências" },
            { value: "estorno", label: "Estornos" },
            ...(cards.length > 0 ? [{ value: "cartao", label: "Cartão de crédito" }] : []),
          ]}
        />
        <MultiSelect
          label="Situação"
          allLabel="Todas as situações"
          value={list("status")}
          onChange={(v) => setList("status", v)}
          options={[
            { value: "efetivado", label: "Efetivados" },
            { value: "pendente", label: "Pendentes" },
            { value: "cancelado", label: "Cancelados" },
          ]}
        />
        <MultiSelect
          label="Conta"
          allLabel="Todas as contas"
          value={list("conta")}
          onChange={(v) => setList("conta", v)}
          options={[
            ...accounts.map((a) => ({ value: a.id, label: a.name, group: "Contas" })),
            ...cards.map((c) => ({ value: c.id, label: c.name, group: "Cartões" })),
          ]}
        />
        <MultiSelect
          label="Categoria"
          allLabel="Todas as categorias"
          value={list("cat")}
          onChange={(v) => setList("cat", v)}
          options={[
            ...categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.name, group: "Despesas" })),
            ...categories.filter((c) => c.kind === "income").map((c) => ({ value: c.id, label: c.name, group: "Receitas" })),
          ]}
        />
      </div>
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            const next = new URLSearchParams();
            const m = sp.get("m");
            if (m) next.set("m", m);
            start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
          }}
          className="inline-flex h-10 items-center justify-center gap-1 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" /> Limpar
        </button>
      )}
    </div>
  );
}
