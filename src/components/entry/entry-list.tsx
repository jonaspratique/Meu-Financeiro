"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight, Ban, Check, Copy, CreditCard, Landmark, Loader2, MoreHorizontal, Pencil, Repeat, RotateCcw, Square, Trash2, Undo2,
} from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import { IconBadge } from "@/components/icon";
import { Money } from "@/components/common/money";
import { createRefund, deleteEntry, endRecurring, setEntryStatus } from "@/lib/actions/entries";
import { deleteCardPurchase, deleteStatementPayment, refundCardPurchase } from "@/lib/actions/cards";
import { formatDateBR, formatDayMonth, todayISO } from "@/lib/finance/dates";
import { centsToInput, formatBRL } from "@/lib/finance/money";
import {
  CARD_KIND_LABEL, statusLabel, type CardPurchase, type RepeatValue, type StatementPayment, type Transaction, type Transfer,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useEntryDialog } from "./entry-provider";

export type ListItem =
  | { kind: "transaction"; t: Transaction }
  | { kind: "transfer"; t: Transfer }
  | { kind: "card"; t: CardPurchase; installment?: { number: number; totalNumber: number; amountCents: number } }
  | { kind: "payment"; t: StatementPayment };

type Result = { ok: boolean; error?: string; message?: string };
function useRun() {
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Feito");
      else toast.error(r.error ?? "Erro");
    });
  return { busy, run };
}

export function EntryList({
  items,
  groupByDay = false,
  showDate = true,
  refundedByExpense = {},
  refundedByPurchase = {},
}: {
  items: ListItem[];
  groupByDay?: boolean;
  showDate?: boolean;
  /** total estornado por despesa (para limitar novos estornos) */
  refundedByExpense?: Record<string, number>;
  refundedByPurchase?: Record<string, number>;
}) {
  const row = (it: ListItem, date: boolean) => {
    switch (it.kind) {
      case "card":
        return (
          <CardRow
            key={it.installment ? `${it.t.id}-${it.installment.number}` : it.t.id}
            p={it.t}
            installment={it.installment}
            showDate={date}
            refunded={refundedByPurchase[it.t.id] ?? 0}
          />
        );
      case "payment":
        return <PaymentRow key={it.t.id} p={it.t} showDate={date} />;
      default:
        return <EntryRow key={it.t.id} item={it} showDate={date} refunded={refundedByExpense[it.t.id] ?? 0} />;
    }
  };
  if (!groupByDay) return <ul className="divide-y">{items.map((it) => row(it, showDate))}</ul>;

  const groups = new Map<string, ListItem[]>();
  for (const it of items) {
    const list = groups.get(it.t.date) ?? [];
    list.push(it);
    groups.set(it.t.date, list);
  }
  const today = todayISO();
  return (
    <div className="grid grid-cols-1 gap-1">
      {[...groups.entries()].map(([date, list]) => (
        <section key={date}>
          <h3 className="sticky top-14 z-10 bg-card/95 px-5 py-2 text-xs font-medium text-muted-foreground backdrop-blur md:top-0">
            {date === today ? "Hoje" : formatDateBR(date)}
          </h3>
          <ul className="divide-y">{list.map((it) => row(it, false))}</ul>
        </section>
      ))}
    </div>
  );
}

function RowShell({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <li className={cn("flex items-center gap-3 px-5 py-3", muted && "opacity-55")}>{children}</li>;
}

function ActionsButton({ label, busy, children }: { label: string; busy: boolean; children: React.ReactNode }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${label}`} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </MenuTrigger>
      <MenuContent>{children}</MenuContent>
    </Menu>
  );
}

function repeatOf(rule: { frequency: string; intervalCount: number } | undefined): RepeatValue {
  return (rule ? `${rule.frequency}-${rule.intervalCount}` : "monthly-1") as RepeatValue;
}

/* --------------------------- conta / transferência --------------------------- */
function EntryRow({
  item,
  showDate,
  refunded,
}: {
  item: { kind: "transaction"; t: Transaction } | { kind: "transfer"; t: Transfer };
  showDate: boolean;
  refunded: number;
}) {
  const { accounts, categories, rules, openDraft } = useEntryDialog();
  const { busy, run } = useRun();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const today = todayISO();
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Conta";

  const t = item.t;
  const isTransfer = item.kind === "transfer";
  const txn = item.kind === "transaction" ? item.t : null;
  const category = txn?.categoryId ? categories.find((c) => c.id === txn.categoryId) : undefined;
  const overdue = t.status === "pending" && t.date < today;
  const cancelled = t.status === "cancelled";
  const rule = txn?.recurringRuleId ? rules.find((r) => r.id === txn.recurringRuleId) : undefined;

  const amountTone = isTransfer ? "none" : txn!.type === "expense" ? "negative" : "positive";
  const signedAmount = isTransfer ? t.amountCents : txn!.type === "expense" ? -t.amountCents : t.amountCents;
  const subtitle = isTransfer
    ? `${accName((t as Transfer).fromAccountId)} → ${accName((t as Transfer).toAccountId)}`
    : [txn!.type === "refund" ? "Estorno" : category?.name, accName(txn!.accountId)].filter(Boolean).join(" · ");
  const kindForStatus = isTransfer ? "transfer" : txn!.type;
  const canRefund = txn?.type === "expense" && txn.status === "paid" && refunded < txn.amountCents;
  const tableKind = isTransfer ? "transfer" : "transaction";

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
      return;
    }
    const x = txn!;
    openDraft({
      kind: x.type === "income" ? "income" : "expense",
      id: duplicate ? undefined : x.id,
      source: "transaction",
      description: x.description,
      amountCents: x.amountCents,
      date: duplicate ? today : x.date,
      status: duplicate ? "paid" : x.status === "cancelled" ? "pending" : x.status,
      paidAt: duplicate ? null : x.paidAt,
      accountId: x.accountId,
      categoryId: x.categoryId,
      paymentMethod: x.paymentMethod,
      notes: x.notes,
      ...(!duplicate && x.recurringRuleId
        ? { recurringRuleId: x.recurringRuleId, occurrenceDate: x.occurrenceDate, repeat: repeatOf(rule), repeatUntil: rule?.endDate }
        : {}),
    });
  };

  return (
    <RowShell muted={cancelled}>
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
        <p className={cn("flex items-center gap-1.5 truncate text-sm font-medium", cancelled && "line-through")}>
          <span className="truncate">{t.description}</span>
          {txn?.recurringRuleId && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label="Recorrente" />}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {showDate && <span className="tabular">{formatDayMonth(t.date)} · </span>}
          {subtitle}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1">
        <Money cents={signedAmount} tone={cancelled ? "muted" : amountTone} sign={!isTransfer} className="text-sm font-semibold" />
        {t.status !== "paid" && (
          <Badge tone={cancelled ? "neutral" : overdue ? "negative" : "warning"}>{overdue ? "Vencido" : statusLabel(kindForStatus, t.status)}</Badge>
        )}
      </div>

      <ActionsButton label={t.description} busy={busy}>
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
        {txn?.recurringRuleId && txn.occurrenceDate && (
          <MenuItem onSelect={() => setConfirmEnd(true)}>
            <Square /> Encerrar recorrência
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem destructive onSelect={() => setConfirmDelete(true)}>
          <Trash2 /> Excluir
        </MenuItem>
      </ActionsButton>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir lançamento?"
        description={
          txn?.recurringRuleId
            ? `"${t.description}" será removido. As outras ocorrências da recorrência continuam; para parar de repetir, use "Encerrar recorrência".`
            : `"${t.description}" será removido definitivamente e os saldos serão recalculados.`
        }
        confirmLabel="Excluir"
        onConfirm={() => run(() => deleteEntry(tableKind, t.id))}
      />
      {txn?.recurringRuleId && txn.occurrenceDate && (
        <ConfirmDialog
          open={confirmEnd}
          onOpenChange={setConfirmEnd}
          title="Encerrar recorrência?"
          description={`Remove este e os próximos lançamentos previstos de "${t.description}" (a partir de ${formatDateBR(txn.occurrenceDate)}). O que já foi pago continua no histórico.`}
          confirmLabel="Encerrar"
          onConfirm={() => run(() => endRecurring(txn.recurringRuleId!, txn.occurrenceDate!))}
        />
      )}
      {txn && canRefund && <RefundDialog open={refundOpen} onOpenChange={setRefundOpen} expense={txn} alreadyRefunded={refunded} />}
    </RowShell>
  );
}

/* --------------------------------- cartão --------------------------------- */
function CardRow({
  p,
  showDate,
  refunded,
  installment,
}: {
  p: CardPurchase;
  showDate: boolean;
  refunded: number;
  installment?: { number: number; totalNumber: number; amountCents: number };
}) {
  const { cards, categories, rules, openDraft } = useEntryDialog();
  const { busy, run } = useRun();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const card = cards.find((c) => c.id === p.cardId);
  const category = categories.find((c) => c.id === p.categoryId);
  const isCharge = p.kind === "purchase" || p.kind === "fee";
  const rule = p.recurringRuleId ? rules.find((r) => r.id === p.recurringRuleId) : undefined;
  const canRefund = p.kind === "purchase" && refunded < p.totalCents;

  const detail = installment
    ? [installment.totalNumber > 1 ? `Parcela ${installment.number}/${installment.totalNumber}` : null, p.kind === "purchase" ? category?.name : CARD_KIND_LABEL[p.kind]]
        .filter(Boolean)
        .join(" · ")
    : p.kind === "purchase"
      ? p.installments > 1
        ? `${p.installments}x de ${formatBRL(Math.floor(p.totalCents / p.installments))}`
        : category?.name
      : CARD_KIND_LABEL[p.kind];

  const edit = (duplicate: boolean) =>
    openDraft({
      kind: "expense",
      id: duplicate ? undefined : p.id,
      source: duplicate ? undefined : "card",
      cardId: p.cardId,
      description: p.description,
      amountCents: p.totalCents,
      date: duplicate ? todayISO() : p.purchaseDate,
      categoryId: p.categoryId,
      installments: p.installments,
      notes: p.notes,
      ...(!duplicate && p.recurringRuleId
        ? { recurringRuleId: p.recurringRuleId, occurrenceDate: p.occurrenceDate, repeat: repeatOf(rule), repeatUntil: rule?.endDate }
        : {}),
    });

  return (
    <RowShell>
      <span
        className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in oklab, ${card?.color ?? "#6366f1"} 14%, transparent)`, color: card?.color ?? "#6366f1" }}
      >
        {p.kind === "refund" || p.kind === "credit" ? <RotateCcw className="size-[18px]" /> : <CreditCard className="size-[18px]" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{p.description}</span>
          {p.recurringRuleId && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label="Recorrente" />}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {installment ? (
            <>
              <span className="tabular">
                {p.kind === "purchase" ? "Compra " : ""}
                {formatDayMonth(p.purchaseDate)}
              </span>
              {detail ? ` · ${detail}` : ""}
            </>
          ) : (
            <>
              {showDate && <span className="tabular">{formatDayMonth(p.purchaseDate)} · </span>}
              {[card?.name ?? "Cartão", detail].filter(Boolean).join(" · ")}
            </>
          )}
        </p>
      </div>
      <Money
        cents={installment ? -installment.amountCents : isCharge ? -p.totalCents : p.totalCents}
        tone={isCharge ? "negative" : "positive"}
        sign
        className="text-sm font-semibold"
      />
      <ActionsButton label={p.description} busy={busy}>
        {p.kind === "purchase" && (
          <>
            <MenuItem onSelect={() => edit(false)}>
              <Pencil /> Editar
            </MenuItem>
            <MenuItem onSelect={() => edit(true)}>
              <Copy /> Duplicar
            </MenuItem>
          </>
        )}
        {canRefund && (
          <MenuItem onSelect={() => setRefundOpen(true)}>
            <RotateCcw /> Registrar estorno
          </MenuItem>
        )}
        {p.recurringRuleId && p.occurrenceDate && (
          <MenuItem onSelect={() => setConfirmEnd(true)}>
            <Square /> Encerrar recorrência
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem destructive onSelect={() => setConfirmDelete(true)}>
          <Trash2 /> Excluir
        </MenuItem>
      </ActionsButton>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir lançamento do cartão?"
        description={
          p.installments > 1
            ? `"${p.description}" e todas as ${p.installments} parcelas serão removidas das faturas.`
            : `"${p.description}" será removido da fatura.`
        }
        confirmLabel="Excluir"
        onConfirm={() => run(() => deleteCardPurchase(p.id))}
      />
      {p.recurringRuleId && p.occurrenceDate && (
        <ConfirmDialog
          open={confirmEnd}
          onOpenChange={setConfirmEnd}
          title="Encerrar recorrência?"
          description={`Remove esta cobrança e as próximas de "${p.description}" (a partir de ${formatDateBR(p.occurrenceDate)}).`}
          confirmLabel="Encerrar"
          onConfirm={() => run(() => endRecurring(p.recurringRuleId!, p.occurrenceDate!))}
        />
      )}
      {canRefund && <CardRefundDialog open={refundOpen} onOpenChange={setRefundOpen} purchase={p} alreadyRefunded={refunded} />}
    </RowShell>
  );
}

/* ---------------------------- pagamento de fatura ---------------------------- */
function PaymentRow({ p, showDate }: { p: StatementPayment; showDate: boolean }) {
  const { cards, accounts } = useEntryDialog();
  const { busy, run } = useRun();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const card = cards.find((c) => c.id === p.cardId);
  return (
    <RowShell>
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Landmark className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">Pagamento da fatura {card ? `· ${card.name}` : ""}</p>
        <p className="truncate text-xs text-muted-foreground">
          {showDate && <span className="tabular">{formatDayMonth(p.date)} · </span>}
          {accounts.find((a) => a.id === p.accountId)?.name ?? "Conta"}
        </p>
      </div>
      <Money cents={-p.amountCents} tone="none" className="text-sm font-semibold" />
      <ActionsButton label="pagamento de fatura" busy={busy}>
        <MenuItem destructive onSelect={() => setConfirmDelete(true)}>
          <Trash2 /> Excluir pagamento
        </MenuItem>
      </ActionsButton>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir pagamento?"
        description="O valor volta para o saldo da conta e a fatura fica em aberto novamente."
        confirmLabel="Excluir"
        onConfirm={() => run(() => deleteStatementPayment(p.id))}
      />
    </RowShell>
  );
}

/* --------------------------------- diálogos --------------------------------- */
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

function RefundForm({
  max,
  hint,
  onSubmit,
}: {
  max: number;
  hint?: string;
  onSubmit: (amount: string, date: string) => Promise<Result>;
}) {
  const [amount, setAmount] = useState(centsToInput(max));
  const [date, setDate] = useState(todayISO());
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await onSubmit(amount, date);
          if (r.ok) toast.success(r.message ?? "Estorno registrado");
          else toast.error(r.error);
        });
      }}
    >
      <Field label="Valor estornado" htmlFor="refund-amount" hint={hint ?? `Máximo: R$ ${centsToInput(max)}`}>
        <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Data do estorno" htmlFor="refund-date">
        <Input id="refund-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Confirmar estorno
      </Button>
    </form>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Registrar estorno" description="O valor volta para a mesma conta e é abatido das despesas da categoria original.">
        <RefundForm
          max={expense.amountCents - alreadyRefunded}
          onSubmit={async (amount, date) => {
            const r = await createRefund({ refundOfId: expense.id, amount, date, description: `Estorno: ${expense.description}`.slice(0, 120) });
            if (r.ok) onOpenChange(false);
            return r;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function CardRefundDialog({
  open,
  onOpenChange,
  purchase,
  alreadyRefunded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  purchase: { id: string; totalCents: number };
  alreadyRefunded: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Estorno no cartão" description="Vira um crédito na fatura da data do estorno e abate a despesa na categoria da compra.">
        <RefundForm
          max={purchase.totalCents - alreadyRefunded}
          onSubmit={async (amount, date) => {
            const r = await refundCardPurchase({ purchaseId: purchase.id, amount, date });
            if (r.ok) onOpenChange(false);
            return r;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
