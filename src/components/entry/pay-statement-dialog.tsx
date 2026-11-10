"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { payStatement } from "@/lib/actions/cards";
import { centsToInput, formatBRL } from "@/lib/finance/money";
import { formatDateBR, todayISO } from "@/lib/finance/dates";
import type { Account } from "@/lib/types";

/** Registrar pagamento (total ou parcial) de uma fatura. Usado no cartão e em Movimentações. */
export function PayStatementDialog({
  open,
  onOpenChange,
  statementId,
  remaining,
  accounts,
  defaultAccountId,
  dueDate,
  cardName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  statementId: string;
  remaining: number;
  accounts: Account[];
  defaultAccountId: string | null;
  dueDate: string;
  cardName?: string;
}) {
  const [amount, setAmount] = useState(centsToInput(Math.max(remaining, 0)));
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={cardName ? `Pagar fatura · ${cardName}` : "Pagar fatura"}
        description={`Saldo da fatura: ${formatBRL(remaining)} · vence em ${formatDateBR(dueDate)}. Pagamento parcial é permitido; o restante continua em aberto.`}
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await payStatement({ statementId, accountId, amount, date });
              if (r.ok) {
                toast.success(r.message ?? "Pagamento registrado");
                onOpenChange(false);
              } else toast.error(r.error ?? "Erro");
            });
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
  );
}
