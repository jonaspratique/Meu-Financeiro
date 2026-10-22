"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/entry/entry-list";
import { PALETTE } from "@/components/icon";
import { deleteGoal, deleteSavingsMovement, saveGoal, saveSavingsMovement, setGoalArchived } from "@/lib/actions/savings";
import { centsToInput, formatBRL } from "@/lib/finance/money";
import { todayISO } from "@/lib/finance/dates";
import { GOAL_KIND_LABEL, type GoalKind, type SavingsGoal } from "@/lib/types";
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

export function GoalDialog({ goal, open, onOpenChange }: { goal?: SavingsGoal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "emergency");
  const [target, setTarget] = useState(goal ? centsToInput(goal.targetCents) : "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [color, setColor] = useState(goal?.color ?? PALETTE[2]);
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={goal ? "Editar reserva" : "Nova reserva"}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => saveGoal({ id: goal?.id, name: name || GOAL_KIND_LABEL[kind], kind, target, targetDate, color }),
              () => onOpenChange(false),
            );
          }}
        >
          <Field label="Objetivo" htmlFor="g-kind">
            <NativeSelect id="g-kind" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
              {Object.entries(GOAL_KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Nome" htmlFor="g-name" hint="Opcional — usa o nome do objetivo">
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={GOAL_KIND_LABEL[kind]} maxLength={60} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meta (R$)" htmlFor="g-target">
              <Input id="g-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="10.000,00" />
            </Field>
            <Field label="Prazo (opcional)" htmlFor="g-date">
              <Input id="g-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
          </div>
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
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {goal ? "Salvar" : "Criar reserva"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewGoalButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)}>
        <Plus /> Nova reserva
      </Button>
      <GoalDialog key={String(open)} open={open} onOpenChange={setOpen} />
    </>
  );
}

export interface AccountOption {
  id: string;
  name: string;
  free: number; // saldo livre (não reservado)
  inGoal: number; // quanto desta reserva está nesta conta
}

function MoveDialog({
  goal,
  accounts,
  initialKind,
  open,
  onOpenChange,
}: {
  goal: SavingsGoal;
  accounts: AccountOption[];
  initialKind: "deposit" | "withdrawal";
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const options = kind === "withdrawal" ? accounts.filter((a) => a.inGoal > 0) : accounts;
  const [accountId, setAccountId] = useState(options[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const { pending, run } = useRun();
  const selected = accounts.find((a) => a.id === accountId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={goal.name}
        description="Um aporte separa parte do saldo de uma conta para esta reserva — o dinheiro não é duplicado nem vira despesa."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveSavingsMovement({ goalId: goal.id, accountId, kind, amount, date }), () => onOpenChange(false));
          }}
        >
          <Segmented
            value={kind}
            onChange={(v) => {
              setKind(v);
              const opts = v === "withdrawal" ? accounts.filter((a) => a.inGoal > 0) : accounts;
              setAccountId(opts[0]?.id ?? "");
            }}
            className="w-full"
            options={[
              { value: "deposit", label: "Aportar" },
              { value: "withdrawal", label: "Retirar" },
            ]}
          />
          <Field
            label={kind === "deposit" ? "Dinheiro guardado na conta" : "Retirar da conta"}
            htmlFor="m-acc"
            hint={
              selected
                ? kind === "deposit"
                  ? `Livre nesta conta: ${formatBRL(selected.free)}`
                  : `Guardado nesta conta: ${formatBRL(selected.inGoal)}`
                : undefined
            }
          >
            <NativeSelect id="m-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {options.length === 0 && <option value="">Nenhuma conta disponível</option>}
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor (R$)" htmlFor="m-amount">
              <Input id="m-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="0,00" />
            </Field>
            <Field label="Data" htmlFor="m-date">
              <Input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" size="lg" disabled={pending || !accountId}>
            {pending && <Loader2 className="animate-spin" />} {kind === "deposit" ? "Registrar aporte" : "Registrar retirada"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GoalActions({ goal, accounts }: { goal: SavingsGoal; accounts: AccountOption[] }) {
  const [move, setMove] = useState<"deposit" | "withdrawal" | null>(null);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const { pending, run } = useRun();
  return (
    <div className="flex items-center gap-2">
      {!goal.archived && (
        <>
          <Button size="sm" variant="subtle" onClick={() => setMove("deposit")}>
            <ArrowDownToLine /> Aportar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMove("withdrawal")}>
            <ArrowUpFromLine /> Retirar
          </Button>
        </>
      )}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`Ações da reserva ${goal.name}`} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setEdit(true)}>
            <Pencil /> Editar meta
          </MenuItem>
          <MenuItem onSelect={() => run(() => setGoalArchived(goal.id, !goal.archived))}>
            {goal.archived ? <ArchiveRestore /> : <Archive />} {goal.archived ? "Reativar" : "Arquivar"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setDel(true)}>
            <Trash2 /> Excluir reserva
          </MenuItem>
        </MenuContent>
      </Menu>
      {move && (
        <MoveDialog goal={goal} accounts={accounts} initialKind={move} open onOpenChange={(o) => !o && setMove(null)} />
      )}
      <GoalDialog key={`e${edit}`} goal={goal} open={edit} onOpenChange={setEdit} />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title="Excluir reserva?"
        description="O histórico de aportes e retiradas será apagado. O dinheiro continua nas contas, apenas deixa de estar reservado."
        confirmLabel="Excluir"
        onConfirm={() => run(() => deleteGoal(goal.id))}
      />
    </div>
  );
}

export function DeleteMovementButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Remover movimentação" disabled={pending} onClick={() => run(() => deleteSavingsMovement(id))}>
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}
