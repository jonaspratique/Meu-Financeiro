"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight, Ban, Check, Copy, Loader2, MoreHorizontal, Pencil, RotateCcw, Trash2, Undo2,
} from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import { IconBadge } from "@/components/icon";
import { Money } from "@/components/common/money";
import { createRefund, deleteEntry, setEntryStatus } from "@/lib/actions/entries";
import { formatDateBR, formatDayMonth, todayISO } from "@/lib/finance/dates";
import { centsToInput } from "@/lib/finance/money";
import { statusLabel, type Transaction, type Transfer } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useEntryDialog } from "./entry-provider";

export type ListItem = { kind: "transaction"; t: Transaction } | { kind: "transfer"; t: Transfer };

export function EntryList({
  items,
  groupByDay = false,
  showDate = true,
  refundedByExpense = {},
}: {
  items: ListItem[];
  groupByDay?: boolean;
  showDate?: boolean;
  /** total estornado por despesa (para limitar novos estornos) */
  refundedByExpense?: Record<string, number>;
}) {
  if (!groupByDay) {
    return (
      <ul className="divide-y">
        {items.map((it) => (
          <EntryRow key={it.t.id} item={it} showDate={showDate} refunded={refundedByExpense[it.t.id] ?? 0} />
        ))}
      </ul>
    );
  }
  const groups = new Map<string, ListItem[]>();
  for (const it of items) {
    const list = groups.get(it.t.date) ?? [];
    list.push(it);
    groups.set(it.t.date, list);
  }
  const today = todayISO();
  return (
    <div className="grid gap-1">
      {[...groups.entries()].map(([date, list]) => (
        <section key={date}>
          <h3 className="sticky top-14 z-10 bg-card/95 px-5 py-2 text-xs font-medium text-muted-foreground backdrop-blur md:top-0">
            {date === today ? "Hoje" : formatDateBR(date)}
          </h3>
          <ul className="divide-y">
            {list.map((it) => (
              <EntryRow key={it.t.id} item={it} showDate={false} refunded={refundedByExpense[it.t.id] ?? 0} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EntryRow({ item, showDate, refunded }: { item: ListItem; showDate: boolean; refunded: number }) {
  const { accounts, categories, openDraft } = useEntryDialog();
  const [busy, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const today = todayISO();
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Conta";

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Feito");
      else toast.error(r.error ?? "Erro");
    });

  const t = item.t;
  const isTransfer = item.kind === "transfer";
  const txn = item.kind === "transaction" ? item.t : null;
  const category = txn?.categoryId ? categories.find((c) => c.id === txn.categoryId) : undefined;
  const overdue = t.status === "pending" && t.date < today;
  const cancelled = t.status === "cancelled";

  const amountTone = isTransfer ? "none" : txn!.type === "expense" ? "negative" : "positive";
  const signedAmount = isTransfer ? t.amountCents : txn!.type === "expense" ? -t.amountCents : t.amountCents;

  const subtitle = isTransfer
    ? `${accName((t as Transfer).fromAccountId)} → ${accName((t as Transfer).toAccountId)}`
    : [txn!.type === "refund" ? "Estorno" : category?.name, accName(txn!.accountId)].filter(Boolean).join(" · ");

  const kindForStatus = isTransfer ? "transfer" : txn!.type;
  const canRefund = txn?.type === "expense" && txn.status === "paid" && refunded < txn.amountCents;

  const edit = (duplicate: boolean) => {
    if (isTransfer) {
      const tr = t as Transfer;
      openDraft({
        kind: "transfer",
        id: duplicate ? undefined : tr.id,
        description: tr.description,
        amountCents: tr.amountCents,
        date: duplicate ? today : tr.date,
        status: duplicate ? "paid" : tr.status === "cancelled" ? "pending" : tr.status,
        paidAt: duplicate ? null : tr.paidAt,
        fromAccountId: tr.fromAccountId,
        toAccountId: tr.toAccountId,
        notes: tr.notes,
      });
    } else {
      const x = txn!;
      openDraft({
        kind: x.type === "income" ? "income" : "expense",
        id: duplicate ? undefined : x.id,
        description: x.description,
        amountCents: x.amountCents,
        date: duplicate ? today : x.date,
        status: duplicate ? "paid" : x.status === "cancelled" ? "pending" : x.status,
        paidAt: duplicate ? null : x.paidAt,
        accountId: x.accountId,
        categoryId: x.categoryId,
        paymentMethod: x.paymentMethod,
        notes: x.notes,
      });
    }
  };

  const tableKind = isTransfer ? "transfer" : "transaction";

  return (
    <li className={cn("flex items-center gap-3 px-5 py-3", cancelled && "opacity-55")}>
      {isTransfer ? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <ArrowLeftRight className="size-[18px]" />
        </span>
      ) : txn!.type === "refund" ? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-positive-soft text-positive">
          <RotateCcw className="size-[18px]" />
        </span>
      ) : (
        <IconBadge name={category?.icon ?? "tag"} color={category?.color ?? "#64748b"} />
      )}

      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", cancelled && "line-through")}>{t.description}</p>
        <p className="truncate text-xs text-muted-foreground">
          {showDate && <span className="tabular">{formatDayMonth(t.date)} · </span>}
          {subtitle}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1">
        <Money cents={signedAmount} tone={cancelled ? "muted" : amountTone} sign={!isTransfer} className="text-sm font-semibold" />
        {t.status !== "paid" && (
          <Badge tone={cancelled ? "neutral" : overdue ? "negative" : "warning"}>
            {overdue ? "Vencido" : statusLabel(kindForStatus, t.status)}
          </Badge>
        )}
      </div>

      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${t.description}`} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </MenuTrigger>
        <MenuContent>
          {t.status === "pending" && (
            <MenuItem onSelect={() => run(() => setEntryStatus(tableKind, t.id, "paid"))}>
              <Check /> {isTransfer ? "Marcar como efetivada" : txn!.type === "income" ? "Marcar como recebido" : "Marcar como pago"}
            </MenuItem>
          )}
          {t.status === "paid" && txn?.type !== "refund" && (
            <MenuItem onSelect={() => run(() => setEntryStatus(tableKind, t.id, "pending"))}>
              <Undo2 /> Voltar para pendente
            </MenuItem>
          )}
          {txn?.type !== "refund" && (
            <MenuItem onSelect={() => edit(false)}>
              <Pencil /> Editar
            </MenuItem>
          )}
          {txn?.type !== "refund" && (
            <MenuItem onSelect={() => edit(true)}>
              <Copy /> Duplicar
            </MenuItem>
          )}
          {canRefund && (
            <MenuItem onSelect={() => setRefundOpen(true)}>
              <RotateCcw /> Registrar estorno
            </MenuItem>
          )}
          {t.status === "pending" && (
            <MenuItem onSelect={() => run(() => setEntryStatus(tableKind, t.id, "cancelled"))}>
              <Ban /> Cancelar
            </MenuItem>
          )}
          {cancelled && (
            <MenuItem onSelect={() => run(() => setEntryStatus(tableKind, t.id, "pending"))}>
              <Undo2 /> Reativar
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setConfirmDelete(true)}>
            <Trash2 /> Excluir
          </MenuItem>
        </MenuContent>
      </Menu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir lançamento?"
        description={`"${t.description}" será removido definitivamente e os saldos serão recalculados.`}
        confirmLabel="Excluir"
        onConfirm={() => run(() => deleteEntry(tableKind, t.id))}
      />
      {txn && canRefund && (
        <RefundDialog open={refundOpen} onOpenChange={setRefundOpen} expense={txn} alreadyRefunded={refunded} />
      )}
    </li>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  open,
  onOpenChange,
  expense,
  alreadyRefunded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  expense: Transaction;
  alreadyRefunded: number;
}) {
  const max = expense.amountCents - alreadyRefunded;
  const [amount, setAmount] = useState(centsToInput(max));
  const [date, setDate] = useState(todayISO());
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Registrar estorno"
        description="O valor volta para a mesma conta e é abatido das despesas da categoria original."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createRefund({
                refundOfId: expense.id,
                amount,
                date,
                description: `Estorno: ${expense.description}`.slice(0, 120),
              });
              if (r.ok) {
                toast.success(r.message ?? "Estorno registrado");
                onOpenChange(false);
              } else toast.error(r.error);
            });
          }}
        >
          <Field label="Valor estornado" htmlFor="refund-amount" hint={`Máximo: R$ ${centsToInput(max)}`}>
            <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Data do estorno" htmlFor="refund-date">
            <Input id="refund-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Confirmar estorno
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
