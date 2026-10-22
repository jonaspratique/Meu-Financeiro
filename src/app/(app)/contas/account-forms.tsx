"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2, MoreHorizontal, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/entry/entry-list";
import { PALETTE } from "@/components/icon";
import { deleteAccount, deleteAdjustment, reconcileAccount, saveAccount, setAccountArchived } from "@/lib/actions/accounts";
import { accountSchema } from "@/lib/validation";
import { centsToInput } from "@/lib/finance/money";
import { todayISO } from "@/lib/finance/dates";
import { ACCOUNT_TYPE_LABEL, type Account, type AccountType } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AccountValues {
  name: string;
  type: AccountType;
  isOperational: boolean;
  initialBalance: string;
  initialBalanceDate: string;
  color: string;
  isDefault: boolean;
}

export function AccountDialog({
  account,
  open,
  onOpenChange,
  isFirst,
}: {
  account?: Account;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  isFirst?: boolean;
}) {
  const [pending, start] = useTransition();
  const form = useForm<AccountValues>({
    defaultValues: {
      name: account?.name ?? "",
      type: account?.type ?? "digital",
      isOperational: account?.isOperational ?? true,
      initialBalance: account ? centsToInput(account.initialBalanceCents) : "",
      initialBalanceDate: account?.initialBalanceDate ?? todayISO(),
      color: account?.color ?? PALETTE[0],
      isDefault: account?.isDefault ?? Boolean(isFirst),
    },
  });
  const { register, handleSubmit, setValue, setError, formState, control } = form;
  const color = useWatch({ control, name: "color" });
  const isOperational = useWatch({ control, name: "isOperational" });
  const isDefault = useWatch({ control, name: "isDefault" });

  const onSubmit = handleSubmit((v) => {
    const payload = { ...v, id: account?.id };
    const parsed = accountSchema.safeParse(payload);
    if (!parsed.success) {
      for (const i of parsed.error.issues) setError(String(i.path[0]) as keyof AccountValues, { message: i.message });
      return;
    }
    start(async () => {
      const r = await saveAccount(payload);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Salvo");
      onOpenChange(false);
    });
  });

  const err = (k: keyof AccountValues) => formState.errors[k]?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={account ? "Editar conta" : "Nova conta"}>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Nome" htmlFor="acc-name" error={err("name")}>
            <Input id="acc-name" placeholder="Ex.: Nubank" autoFocus maxLength={60} {...register("name")} />
          </Field>
          <Field label="Tipo" htmlFor="acc-type">
            <NativeSelect
              id="acc-type"
              {...register("type", {
                onChange: (e) => setValue("isOperational", !["savings", "investment"].includes(e.target.value)),
              })}
            >
              {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Saldo inicial (R$)" htmlFor="acc-balance" error={err("initialBalance")}>
              <Input id="acc-balance" inputMode="decimal" placeholder="0,00" {...register("initialBalance")} />
            </Field>
            <Field label="Na data" htmlFor="acc-date" error={err("initialBalanceDate")}>
              <Input id="acc-date" type="date" {...register("initialBalanceDate")} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Informe o saldo real da conta nessa data. Lançamentos anteriores a ela ficam no histórico, mas não alteram o saldo.
          </p>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Cor</span>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setValue("color", c)}
                  className={cn("size-7 rounded-full ring-offset-2 ring-offset-card transition", color === c && "ring-2 ring-foreground")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <span>
              <span className="block text-sm font-medium">Compõe o saldo disponível</span>
              <span className="block text-xs text-muted-foreground">Desligue para poupança e investimentos que você não usa no dia a dia.</span>
            </span>
            <Switch checked={isOperational} onCheckedChange={(v) => setValue("isOperational", v)} />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <span>
              <span className="block text-sm font-medium">Conta padrão</span>
              <span className="block text-xs text-muted-foreground">Vem selecionada nos novos lançamentos.</span>
            </span>
            <Switch checked={isDefault} onCheckedChange={(v) => setValue("isDefault", v)} />
          </label>
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {account ? "Salvar alterações" : "Criar conta"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewAccountButton({ isFirst }: { isFirst: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(sp.get("nova") === "1");
  return (
    <>
      <Button variant="brand" onClick={() => setOpen(true)}>
        <Plus /> Nova conta
      </Button>
      <AccountDialog
        key={String(open)}
        open={open}
        isFirst={isFirst}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o && sp.get("nova")) router.replace("/contas", { scroll: false });
        }}
      />
    </>
  );
}

function ReconcileDialog({
  account,
  balance,
  open,
  onOpenChange,
}: {
  account: Account;
  balance: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [reported, setReported] = useState(centsToInput(balance));
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Conciliar ${account.name}`}
        description="Informe o saldo que aparece no banco. A diferença vira um ajuste registrado com justificativa — não conta como receita nem despesa."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await reconcileAccount({ accountId: account.id, date, reportedBalance: reported, reason });
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message ?? "Conciliado");
              onOpenChange(false);
            });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Saldo real (R$)" htmlFor="rec-bal">
              <Input id="rec-bal" inputMode="decimal" value={reported} onChange={(e) => setReported(e.target.value)} autoFocus />
            </Field>
            <Field label="Data" htmlFor="rec-date">
              <Input id="rec-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Justificativa" htmlFor="rec-reason" hint="Ex.: tarifa bancária não registrada, rendimento, arredondamento.">
            <Textarea id="rec-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Registrar conciliação
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountActions({ account, balance }: { account: Account; balance: number }) {
  const [edit, setEdit] = useState(false);
  const [rec, setRec] = useState(false);
  const [del, setDel] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Feito");
      else toast.error(r.error ?? "Erro");
    });
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Ações da conta ${account.name}`} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </MenuTrigger>
        <MenuContent>
          {!account.archived && (
            <MenuItem onSelect={() => setRec(true)}>
              <Scale /> Conciliar saldo
            </MenuItem>
          )}
          <MenuItem onSelect={() => setEdit(true)}>
            <Pencil /> Editar
          </MenuItem>
          <MenuItem onSelect={() => run(() => setAccountArchived(account.id, !account.archived))}>
            {account.archived ? <ArchiveRestore /> : <Archive />} {account.archived ? "Reativar" : "Arquivar"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setDel(true)}>
            <Trash2 /> Excluir
          </MenuItem>
        </MenuContent>
      </Menu>
      <AccountDialog key={`e${edit}`} account={account} open={edit} onOpenChange={setEdit} />
      <ReconcileDialog key={`r${rec}`} account={account} balance={balance} open={rec} onOpenChange={setRec} />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title="Excluir conta?"
        description="Só é possível excluir contas sem movimentações. Para contas com histórico, use Arquivar."
        confirmLabel="Excluir"
        onConfirm={() => run(() => deleteAccount(account.id))}
      />
    </>
  );
}

export function DeleteAdjustmentButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remover ajuste"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await deleteAdjustment(id);
          if (r.ok) toast.success(r.message ?? "Removido");
          else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}
