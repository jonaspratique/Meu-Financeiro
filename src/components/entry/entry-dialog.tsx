"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ArrowDown, ChevronDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { DynamicIcon } from "@/components/icon";
import { saveEntry } from "@/lib/actions/entries";
import { entrySchema, PAYMENT_METHODS } from "@/lib/validation";
import { centsToInput } from "@/lib/finance/money";
import { todayISO } from "@/lib/finance/dates";
import { PAYMENT_METHOD_LABEL, type Account, type Category, type PaymentMethod } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { EntryDraft, EntryKind } from "./entry-provider";

interface FormValues {
  kind: EntryKind;
  description: string;
  amount: string;
  date: string;
  status: "paid" | "pending";
  paidAt: string;
  accountId: string;
  categoryId: string;
  paymentMethod: PaymentMethod;
  fromAccountId: string;
  toAccountId: string;
  notes: string;
}

const LAST_CAT_KEY = (k: string) => `mf-last-category-${k}`;
const readLast = (k: string) => {
  try {
    return localStorage.getItem(LAST_CAT_KEY(k)) ?? "";
  } catch {
    return "";
  }
};
const writeLast = (k: string, v: string) => {
  try {
    localStorage.setItem(LAST_CAT_KEY(k), v);
  } catch {}
};

export function EntryDialog({
  open,
  onOpenChange,
  draft,
  accounts,
  categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft: EntryDraft;
  accounts: Account[];
  categories: Category[];
}) {
  const [pending, startTransition] = useTransition();
  const [showMore, setShowMore] = useState(Boolean(draft.notes) || (draft.paidAt != null && draft.paidAt !== draft.date));
  const isEdit = Boolean(draft.id);
  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.archived || a.id === draft.accountId || a.id === draft.fromAccountId || a.id === draft.toAccountId),
    [accounts, draft],
  );
  const defaultAccount = activeAccounts.find((a) => a.isDefault && !a.archived) ?? activeAccounts.find((a) => !a.archived);

  const today = todayISO();
  const form = useForm<FormValues>({
    defaultValues: {
      kind: draft.kind,
      description: draft.description ?? "",
      amount: draft.amountCents ? centsToInput(draft.amountCents) : "",
      date: draft.date ?? today,
      status: draft.status ?? "paid",
      paidAt: draft.paidAt ?? "",
      accountId: draft.accountId ?? defaultAccount?.id ?? "",
      categoryId: draft.categoryId ?? "",
      paymentMethod: draft.paymentMethod ?? "pix",
      fromAccountId: draft.fromAccountId ?? defaultAccount?.id ?? "",
      toAccountId: draft.toAccountId ?? activeAccounts.find((a) => a.id !== defaultAccount?.id && !a.archived)?.id ?? "",
      notes: draft.notes ?? "",
    },
  });
  const { register, setValue, handleSubmit, setError, formState, control } = form;
  const kind = useWatch({ control, name: "kind" });
  const status = useWatch({ control, name: "status" });
  const categoryId = useWatch({ control, name: "categoryId" });
  const date = useWatch({ control, name: "date" });

  const kindCategories = useMemo(
    () => categories.filter((c) => c.kind === kind && (!c.archived || c.id === draft.categoryId)),
    [categories, kind, draft.categoryId],
  );

  // categoria padrão: a última usada para o tipo, senão a primeira
  useEffect(() => {
    if (kind === "transfer") return;
    if (kindCategories.some((c) => c.id === categoryId)) return;
    const last = readLast(kind);
    const pick = kindCategories.find((c) => c.id === last) ?? kindCategories[0];
    setValue("categoryId", pick?.id ?? "");
  }, [kind, kindCategories, categoryId, setValue]);

  const onSubmit = handleSubmit((values) => {
    const category = categories.find((c) => c.id === values.categoryId);
    const description =
      values.description.trim() || (values.kind === "transfer" ? "Transferência" : category?.name ?? "");
    const payload =
      values.kind === "transfer"
        ? {
            kind: "transfer" as const,
            id: draft.id,
            description,
            amount: values.amount,
            date: values.date,
            status: values.status,
            paidAt: values.status === "paid" ? values.paidAt || values.date : "",
            notes: values.notes,
            fromAccountId: values.fromAccountId,
            toAccountId: values.toAccountId,
          }
        : {
            kind: values.kind,
            id: draft.id,
            description,
            amount: values.amount,
            date: values.date,
            status: values.status,
            paidAt: values.status === "paid" ? values.paidAt || values.date : "",
            notes: values.notes,
            accountId: values.accountId,
            categoryId: values.categoryId,
            paymentMethod: values.paymentMethod,
          };

    // validação no cliente (o servidor valida de novo)
    const parsed = entrySchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "amount") as keyof FormValues;
        setError(field, { message: issue.message });
      }
      return;
    }

    startTransition(async () => {
      const res = await saveEntry(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (values.kind !== "transfer") writeLast(values.kind, values.categoryId);
      toast.success(res.message ?? "Salvo");
      onOpenChange(false);
    });
  });

  const err = (k: keyof FormValues) => formState.errors[k]?.message;
  const paidLabel = kind === "income" ? "Recebido" : kind === "transfer" ? "Efetivada" : "Pago";
  const pendingLabel = kind === "income" ? "A receber" : kind === "transfer" ? "Agendada" : "A pagar";
  const noAccounts = activeAccounts.filter((a) => !a.archived).length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? "Editar lançamento" : draft.id === undefined && draft.amountCents ? "Duplicar lançamento" : "Novo lançamento"}
      >
        {noAccounts ? (
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">Cadastre sua primeira conta para começar a lançar.</p>
            <Button asChild>
              <a href="/contas?nova=1">Cadastrar conta</a>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {!(isEdit && draft.kind === "transfer") && (
              <Segmented<EntryKind>
                ariaLabel="Tipo de lançamento"
                value={kind}
                onChange={(v) => setValue("kind", v)}
                className="w-full"
                options={[
                  { value: "expense", label: "Despesa", className: "text-negative" },
                  { value: "income", label: "Receita", className: "text-positive" },
                  ...(isEdit ? [] : [{ value: "transfer" as const, label: "Transferência", className: "text-brand" }]),
                ]}
              />
            )}

            <div className="grid gap-1.5">
              <label htmlFor="amount" className="sr-only">
                Valor
              </label>
              <div
                className={cn(
                  "flex items-baseline gap-2 rounded-2xl border bg-muted/40 px-4 py-3 focus-within:border-ring",
                  err("amount") && "border-negative",
                )}
              >
                <span className="text-lg font-medium text-muted-foreground">R$</span>
                <input
                  id="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  placeholder="0,00"
                  aria-invalid={!!err("amount")}
                  className={cn(
                    "tabular w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50",
                    kind === "income" && "text-positive",
                    kind === "expense" && "text-negative",
                  )}
                  {...register("amount")}
                />
              </div>
              {err("amount") && <p className="text-xs text-negative">{err("amount")}</p>}
            </div>

            <Field label="Descrição" htmlFor="description" error={err("description")} hint="Opcional — usa o nome da categoria se ficar vazio">
              <Input id="description" placeholder={kind === "transfer" ? "Transferência" : "Ex.: Mercado do mês"} maxLength={120} {...register("description")} />
            </Field>

            {kind !== "transfer" ? (
              <>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Categoria</span>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Categoria">
                    {kindCategories.map((c) => {
                      const active = c.id === categoryId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setValue("categoryId", c.id)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition",
                            active ? "border-transparent font-medium text-white" : "hover:bg-muted",
                          )}
                          style={active ? { background: c.color } : undefined}
                        >
                          <DynamicIcon name={c.icon} className="size-3.5" />
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                  {err("categoryId") && <p className="text-xs text-negative">{err("categoryId")}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Conta" htmlFor="accountId" error={err("accountId")}>
                    <NativeSelect id="accountId" {...register("accountId")}>
                      {activeAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Forma de pagamento" htmlFor="paymentMethod">
                    <NativeSelect id="paymentMethod" {...register("paymentMethod")}>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {PAYMENT_METHOD_LABEL[m]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Field label="Sai de" htmlFor="fromAccountId" error={err("fromAccountId")}>
                  <NativeSelect id="fromAccountId" {...register("fromAccountId")}>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <ArrowDown className="mx-auto size-4 text-muted-foreground" aria-hidden />
                <Field label="Entra em" htmlFor="toAccountId" error={err("toAccountId")}>
                  <NativeSelect id="toAccountId" {...register("toAccountId")}>
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={kind === "transfer" ? "Data" : "Data / vencimento"} htmlFor="date" error={err("date")}>
                <Input id="date" type="date" {...register("date")} />
              </Field>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Situação</span>
                <Segmented<"paid" | "pending">
                  ariaLabel="Situação"
                  value={status}
                  onChange={(v) => setValue("status", v)}
                  className="h-10 w-full items-center"
                  options={[
                    { value: "paid", label: paidLabel },
                    { value: "pending", label: pendingLabel },
                  ]}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              className="flex items-center gap-1 justify-self-start text-xs font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={showMore}
            >
              <ChevronDown className={cn("size-3.5 transition", showMore && "rotate-180")} />
              Mais detalhes
            </button>
            {showMore && (
              <div className="grid gap-3">
                {status === "paid" && (
                  <Field
                    label={kind === "income" ? "Recebido em" : "Pago em"}
                    htmlFor="paidAt"
                    error={err("paidAt")}
                    hint="Deixe vazio para usar a mesma data acima. Usado na visão de fluxo de caixa."
                  >
                    <Input id="paidAt" type="date" placeholder={date} {...register("paidAt")} />
                  </Field>
                )}
                <Field label="Observações" htmlFor="notes" error={err("notes")}>
                  <Textarea id="notes" maxLength={1000} {...register("notes")} />
                </Field>
              </div>
            )}

            <Button type="submit" size="lg" disabled={pending} className="mt-1">
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Salvando…" : isEdit ? "Salvar alterações" : "Salvar lançamento"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
