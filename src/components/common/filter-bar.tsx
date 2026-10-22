"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Input, NativeSelect } from "@/components/ui/input";
import type { Account, Category } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Filtros da lista de movimentações, mantidos na URL (podem ser favoritados). */
export function FilterBar({ accounts, categories }: { accounts: Account[]; categories: Category[] }) {
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
        <NativeSelect aria-label="Tipo" value={sp.get("tipo") ?? ""} onChange={(e) => set("tipo", e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="despesa">Despesas</option>
          <option value="receita">Receitas</option>
          <option value="transferencia">Transferências</option>
          <option value="estorno">Estornos</option>
        </NativeSelect>
        <NativeSelect aria-label="Situação" value={sp.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
          <option value="">Todas as situações</option>
          <option value="efetivado">Efetivados</option>
          <option value="pendente">Pendentes</option>
          <option value="cancelado">Cancelados</option>
        </NativeSelect>
        <NativeSelect aria-label="Conta" value={sp.get("conta") ?? ""} onChange={(e) => set("conta", e.target.value)}>
          <option value="">Todas as contas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Categoria" value={sp.get("cat") ?? ""} onChange={(e) => set("cat", e.target.value)}>
          <option value="">Todas as categorias</option>
          <optgroup label="Despesas">
            {categories.filter((c) => c.kind === "expense").map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </optgroup>
          <optgroup label="Receitas">
            {categories.filter((c) => c.kind === "income").map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </optgroup>
        </NativeSelect>
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
