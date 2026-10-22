"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { IconBadge, PALETTE } from "@/components/icon";
import { ConfirmDialog } from "@/components/entry/entry-list";
import { deleteCategory, saveCategory, setCategoryArchived } from "@/lib/actions/categories";
import type { Category, CategoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

function CategoryDialog({ category, kind, open, onOpenChange }: { category?: Category; kind: CategoryKind; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? PALETTE[0]);
  const [isFixed, setFixed] = useState(category?.isFixed ?? false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={category ? "Editar categoria" : `Nova categoria de ${kind === "income" ? "receita" : "despesa"}`}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveCategory({ id: category?.id, name, kind: category?.kind ?? kind, color, isFixed });
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message ?? "Salvo");
              onOpenChange(false);
            });
          }}
        >
          <Field label="Nome" htmlFor="cat-name">
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus required />
          </Field>
          <div className="flex flex-wrap gap-2" aria-label="Cor">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn("size-7 rounded-full ring-offset-2 ring-offset-card", color === c && "ring-2 ring-foreground")}
                style={{ background: c }}
              />
            ))}
          </div>
          <label className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <span>
              <span className="block text-sm font-medium">Gasto/receita fixa</span>
              <span className="block text-xs text-muted-foreground">Usado no relatório de fixas × variáveis.</span>
            </span>
            <Switch checked={isFixed} onCheckedChange={setFixed} />
          </label>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Salvar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CategoryManager({ categories }: { categories: Category[] }) {
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [editing, setEditing] = useState<Category | null | "new">(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [pending, start] = useTransition();
  const list = categories.filter((c) => c.kind === kind).sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Feito");
      else toast.error(r.error ?? "Erro");
    });

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2 px-5">
        <Segmented
          value={kind}
          onChange={setKind}
          size="sm"
          options={[
            { value: "expense", label: "Despesas" },
            { value: "income", label: "Receitas" },
          ]}
        />
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus /> Nova
        </Button>
      </div>
      <ul className={cn("divide-y", pending && "opacity-60")}>
        {list.map((c) => (
          <li key={c.id} className={cn("flex items-center gap-3 px-5 py-2.5", c.archived && "opacity-50")}>
            <IconBadge name={c.icon} color={c.color} className="size-8" />
            <span className="flex-1 text-sm">
              {c.name}
              {c.isFixed && <span className="ml-2 text-xs text-muted-foreground">fixa</span>}
              {c.archived && <span className="ml-2 text-xs text-muted-foreground">arquivada</span>}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label={`Editar ${c.name}`} onClick={() => setEditing(c)}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={c.archived ? `Reativar ${c.name}` : `Arquivar ${c.name}`}
              onClick={() => run(() => setCategoryArchived(c.id, !c.archived))}
            >
              {c.archived ? <ArchiveRestore /> : <Archive />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${c.name}`} onClick={() => setDeleting(c)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      {editing && (
        <CategoryDialog
          category={editing === "new" ? undefined : editing}
          kind={kind}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir categoria?"
        description="Só é possível excluir categorias sem lançamentos. Caso contrário, arquive."
        confirmLabel="Excluir"
        onConfirm={() => deleting && run(() => deleteCategory(deleting.id))}
      />
    </div>
  );
}
