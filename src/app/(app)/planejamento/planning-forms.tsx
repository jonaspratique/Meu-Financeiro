"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Loader2, MoreHorizontal, Pencil, Plus, Square, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/entry/entry-list";
import { copyBudgetsToNextMonth, deleteBudget, saveBudget } from "@/lib/actions/cards";
import { endRecurring } from "@/lib/actions/entries";
import { centsToInput } from "@/lib/finance/money";
import { formatDateBR, formatMonthLong, shiftMonth } from "@/lib/finance/dates";
import type { Category } from "@/lib/types";

type Result = { ok: boolean; error?: string; message?: string };
function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Feito");
        onOk?.();
      } else toast.error(r.error ?? "Erro");
    });
  return { pending, run };
}

function BudgetDialog({
  month,
  categories,
  usedCategoryIds,
  initial,
  open,
  onOpenChange,
}: {
  month: string;
  categories: Category[];
  usedCategoryIds: string[];
  initial?: { categoryId: string; amountCents: number };
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const options = categories.filter(
    (c) => c.kind === "expense" && !c.archived && (c.id === initial?.categoryId || !usedCategoryIds.includes(c.id)),
  );
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? options[0]?.id ?? "");
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : "");
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? "Editar orçamento" : "Novo orçamento"} description={formatMonthLong(month)}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveBudget({ month, categoryId, amount }), () => onOpenChange(false));
          }}
        >
          <Field label="Categoria" htmlFor="b-cat">
            <NativeSelect id="b-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!initial}>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Limite do mês (R$)" htmlFor="b-amount" hint="Você recebe avisos ao atingir 80% e 100%.">
            <Input id="b-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.200,00" autoFocus />
          </Field>
          <Button type="submit" disabled={pending || !categoryId}>
            {pending && <Loader2 className="animate-spin" />} Salvar orçamento
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewBudgetButton({ month, categories, usedCategoryIds }: { month: string; categories: Category[]; usedCategoryIds: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" size="sm" onClick={() => setOpen(true)}>
        <Plus /> Orçamento
      </Button>
      <BudgetDialog key={String(open)} month={month} categories={categories} usedCategoryIds={usedCategoryIds} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function CopyBudgetsButton({ month }: { month: string }) {
  const { pending, run } = useRun();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => copyBudgetsToNextMonth(month))}>
      {pending ? <Loader2 className="animate-spin" /> : <Copy />} Copiar para {formatMonthLong(shiftMonth(month, 1)).split(" de ")[0].toLowerCase()}
    </Button>
  );
}

export function BudgetActions({
  id,
  month,
  categories,
  categoryId,
  amountCents,
}: {
  id: string;
  month: string;
  categories: Category[];
  categoryId: string;
  amountCents: number;
}) {
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Ações do orçamento" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setEdit(true)}>
            <Pencil /> Editar limite
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setDel(true)}>
            <Trash2 /> Remover
          </MenuItem>
        </MenuContent>
      </Menu>
      <BudgetDialog
        key={`e${edit}`}
        month={month}
        categories={categories}
        usedCategoryIds={[]}
        initial={{ categoryId, amountCents }}
        open={edit}
        onOpenChange={setEdit}
      />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title="Remover orçamento?"
        description="Só o limite deste mês é removido. Os lançamentos não mudam."
        confirmLabel="Remover"
        onConfirm={() => run(() => deleteBudget(id))}
      />
    </>
  );
}

export function EndRecurringButton({ ruleId, from, description }: { ruleId: string; from: string; description: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <Button variant="ghost" size="sm" aria-label={`Encerrar ${description}`} disabled={pending} onClick={() => setOpen(true)}>
        {pending ? <Loader2 className="animate-spin" /> : <Square />}
        <span className="hidden sm:inline">Encerrar</span>
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Encerrar recorrência?"
        description={`"${description}" deixa de se repetir a partir de ${formatDateBR(from)}. Lançamentos já pagos continuam no histórico.`}
        confirmLabel="Encerrar"
        onConfirm={() => run(() => endRecurring(ruleId, from))}
      />
    </>
  );
}
