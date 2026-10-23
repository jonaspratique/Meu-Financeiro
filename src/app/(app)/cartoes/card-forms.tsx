"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2, MoreHorizontal, Pencil, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/entry/entry-list";
import { DynamicIcon, PALETTE } from "@/components/icon";
import { deleteCard, payStatement, saveCard, saveCardAdjustment, setCardArchived } from "@/lib/actions/cards";
import { centsToInput, formatBRL } from "@/lib/finance/money";
import { formatDateBR, todayISO } from "@/lib/finance/dates";
import type { Account, Category, CreditCard } from "@/lib/types";
import { cn } from "@/lib/utils";

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

export function CardDialog({
  card,
  accounts,
  open,
  onOpenChange,
}: {
  card?: CreditCard;
  accounts: Account[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState(card?.name ?? "");
  const [limit, setLimit] = useState(card ? centsToInput(card.limitCents) : "");
  const [closingDay, setClosingDay] = useState(String(card?.closingDay ?? ""));
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? ""));
  const [paymentAccountId, setPaymentAccountId] = useState(card?.paymentAccountId ?? accounts.find((a) => a.isDefault)?.id ?? "");
  const [color, setColor] = useState(card?.color ?? PALETTE[8]);
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={card ? "Editar cartão" : "Novo cartão de crédito"}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveCard({ id: card?.id, name, limit, closingDay, dueDay, color, paymentAccountId }), () => onOpenChange(false));
          }}
        >
          <Field label="Nome" htmlFor="card-name">
            <Input id="card-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank" maxLength={60} autoFocus required />
          </Field>
          <Field label="Limite (R$)" htmlFor="card-limit" hint="Serve só para acompanhar o uso. Limite nunca conta como dinheiro disponível.">
            <Input id="card-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="5.000,00" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dia do fechamento" htmlFor="card-closing" hint="Compras a partir deste dia vão para a fatura seguinte.">
              <Input id="card-closing" type="number" inputMode="numeric" min={1} max={31} value={closingDay} onChange={(e) => setClosingDay(e.target.value)} required />
            </Field>
            <Field label="Dia do vencimento" htmlFor="card-due">
              <Input id="card-due" type="number" inputMode="numeric" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} required />
            </Field>
          </div>
          <Field label="Conta que paga a fatura" htmlFor="card-account" hint="Sugerida ao registrar o pagamento.">
            <NativeSelect id="card-account" value={paymentAccountId} onChange={(e) => setPaymentAccountId(e.target.value)}>
              <option value="">Escolher na hora</option>
              {accounts.filter((a) => !a.archived).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
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
          {card && (
            <p className="text-xs text-muted-foreground">Mudar os dias vale para faturas novas; faturas já criadas mantêm as datas.</p>
          )}
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {card ? "Salvar" : "Criar cartão"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewCardButton({ accounts, variant = "outline" }: { accounts: Account[]; variant?: "outline" | "brand" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> Novo cartão
      </Button>
      <CardDialog key={String(open)} accounts={accounts} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function CardActions({ card, accounts }: { card: CreditCard; accounts: Account[] }) {
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Ações do cartão ${card.name}`} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setEdit(true)}>
            <Pencil /> Editar
          </MenuItem>
          <MenuItem onSelect={() => run(() => setCardArchived(card.id, !card.archived))}>
            {card.archived ? <ArchiveRestore /> : <Archive />} {card.archived ? "Reativar" : "Arquivar"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setDel(true)}>
            <Trash2 /> Excluir
          </MenuItem>
        </MenuContent>
      </Menu>
      <CardDialog key={`e${edit}`} card={card} accounts={accounts} open={edit} onOpenChange={setEdit} />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title="Excluir cartão?"
        description="Só é possível excluir cartões sem lançamentos. Com histórico, use Arquivar."
        confirmLabel="Excluir"
        onConfirm={() => run(() => deleteCard(card.id))}
      />
    </>
  );
}

export function PayStatementButton({
  statementId,
  remaining,
  accounts,
  defaultAccountId,
  dueDate,
}: {
  statementId: string;
  remaining: number;
  accounts: Account[];
  defaultAccountId: string | null;
  dueDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(centsToInput(Math.max(remaining, 0)));
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const { pending, run } = useRun();
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)}>
        <Wallet /> Pagar fatura
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Pagar fatura"
          description={`Saldo da fatura: ${formatBRL(remaining)} · vence em ${formatDateBR(dueDate)}. Pagamento parcial é permitido; o restante continua em aberto.`}
        >
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => payStatement({ statementId, accountId, amount, date }), () => setOpen(false));
            }}
          >
            <Field label="Valor pago (R$)" htmlFor="pay-amount">
              <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pago com a conta" htmlFor="pay-account">
                <NativeSelect id="pay-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.filter((a) => !a.archived).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Data do pagamento" htmlFor="pay-date">
                <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              O pagamento sai do saldo da conta, mas não é uma despesa nova: as compras já foram contadas como despesa nas parcelas.
            </p>
            <Button type="submit" size="lg" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Registrar pagamento
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdjustmentButton({ cardId, categories }: { cardId: string; categories: Category[] }) {
  const expenseCats = categories.filter((c) => c.kind === "expense" && !c.archived);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"fee" | "credit">("fee");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState(expenseCats.find((c) => c.name === "Impostos e taxas")?.id ?? expenseCats[0]?.id ?? "");
  const { pending, run } = useRun();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Receipt /> Tarifa ou ajuste
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Tarifa, juros ou ajuste" description="Lançado na fatura da data informada.">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  saveCardAdjustment({
                    cardId,
                    kind,
                    description: description || (kind === "fee" ? "Tarifa do cartão" : "Crédito na fatura"),
                    amount,
                    date,
                    categoryId,
                  }),
                () => setOpen(false),
              );
            }}
          >
            <Segmented
              value={kind}
              onChange={setKind}
              className="w-full"
              options={[
                { value: "fee", label: "Cobrança (tarifa, juros, IOF)" },
                { value: "credit", label: "Crédito a favor" },
              ]}
            />
            <Field label="Descrição" htmlFor="adj-desc">
              <Input id="adj-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "fee" ? "Ex.: Anuidade" : "Ex.: Cashback"} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor (R$)" htmlFor="adj-amount">
                <Input id="adj-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
              </Field>
              <Field label="Data" htmlFor="adj-date">
                <Input id="adj-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Categoria" htmlFor="adj-cat" hint={kind === "credit" ? "O crédito abate despesas desta categoria." : undefined}>
              <NativeSelect id="adj-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {expenseCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Lançar na fatura
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CardIcon({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl", className)}
      style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
    >
      <DynamicIcon name="credit-card" className="size-[18px]" />
    </span>
  );
}
