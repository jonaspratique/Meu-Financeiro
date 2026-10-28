"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { MicButton } from "./mic-button";
import { ArrowDown, ChevronDown, CreditCard as CardIcon, Loader2, Repeat, Sparkles } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { DynamicIcon } from "@/components/icon";
import { saveEntry } from "@/lib/actions/entries";
import { getQuickHints } from "@/lib/actions/quick";
import { quickParse } from "@/lib/finance/quick-parse";
import { entrySchema, PAYMENT_METHODS } from "@/lib/validation";
import { centsToInput, formatBRL, parseBRL } from "@/lib/finance/money";
import { formatDateBR, isISODate, todayISO } from "@/lib/finance/dates";
import { previewInstallments } from "@/lib/finance/cards";
import {
  PAYMENT_METHOD_LABEL, REPEAT_OPTIONS, type Account, type Category, type CreditCard, type PaymentMethod, type RepeatValue,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import type { EntryDraft, EntryKind } from "./entry-provider";

interface FormValues {
  kind: EntryKind;
  description: string;
  amount: string;
  date: string;
  status: "paid" | "pending";
  paidAt: string;
  accountId: string; // uuid da conta ou "card:<uuid>"
  categoryId: string;
  paymentMethod: PaymentMethod;
  fromAccountId: string;
  toAccountId: string;
  notes: string;
  installments: string;
  repeat: RepeatValue;
  repeatUntil: string;
  scope: "one" | "series";
}

const LAST_CAT_KEY = (k: string) => `mf-last-category-${k}`;
const LAST_DEST_KEY = "mf-last-destination";
const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function EntryDialog({
  open,
  onOpenChange,
  draft,
  accounts,
  categories,
  cards,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft: EntryDraft;
  accounts: Account[];
  categories: Category[];
  cards: CreditCard[];
}) {
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(draft.id);
  const isCardEdit = isEdit && draft.source === "card";
  const isRecurringOccurrence = isEdit && Boolean(draft.recurringRuleId);
  const [showMore, setShowMore] = useState(
    Boolean(draft.notes) || (draft.paidAt != null && draft.paidAt !== draft.date) || (!isEdit && !!draft.repeat && draft.repeat !== "none"),
  );

  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.archived || a.id === draft.accountId || a.id === draft.fromAccountId || a.id === draft.toAccountId),
    [accounts, draft],
  );
  const activeCards = useMemo(() => cards.filter((c) => !c.archived || c.id === draft.cardId), [cards, draft.cardId]);
  const defaultAccount = activeAccounts.find((a) => a.isDefault && !a.archived) ?? activeAccounts.find((a) => !a.archived);

  // destino padrão: o último usado (conta ou cartão), senão a conta padrão
  const initialDestination = (() => {
    if (draft.cardId) return `card:${draft.cardId}`;
    if (draft.accountId) return draft.accountId;
    const last = typeof window !== "undefined" ? read(LAST_DEST_KEY) : "";
    if (last.startsWith("card:") && activeCards.some((c) => `card:${c.id}` === last && !c.archived)) return draft.kind === "expense" ? last : defaultAccount?.id ?? "";
    if (activeAccounts.some((a) => a.id === last && !a.archived)) return last;
    return defaultAccount?.id ?? "";
  })();

  const today = todayISO();
  const form = useForm<FormValues>({
    defaultValues: {
      kind: draft.kind,
      description: draft.description ?? "",
      amount: draft.amountCents ? centsToInput(draft.amountCents) : "",
      date: draft.date ?? today,
      status: draft.status ?? "paid",
      paidAt: draft.paidAt ?? "",
      accountId: initialDestination,
      categoryId: draft.categoryId ?? "",
      paymentMethod: draft.paymentMethod ?? "pix",
      fromAccountId: draft.fromAccountId ?? defaultAccount?.id ?? "",
      toAccountId: draft.toAccountId ?? activeAccounts.find((a) => a.id !== defaultAccount?.id && !a.archived)?.id ?? "",
      notes: draft.notes ?? "",
      installments: String(draft.installments ?? 1),
      repeat: draft.repeat ?? "none",
      repeatUntil: draft.repeatUntil ?? "",
      scope: "one",
    },
  });
  const { register, setValue, handleSubmit, setError, formState, control } = form;
  const kind = useWatch({ control, name: "kind" });
  const status = useWatch({ control, name: "status" });
  const categoryId = useWatch({ control, name: "categoryId" });
  const accountId = useWatch({ control, name: "accountId" });
  const amount = useWatch({ control, name: "amount" });
  const date = useWatch({ control, name: "date" });
  const installments = useWatch({ control, name: "installments" });
  const repeat = useWatch({ control, name: "repeat" });
  const scope = useWatch({ control, name: "scope" });

  /* ----------------------- lançamento por frase ----------------------- */
  const [quick, setQuick] = useState(draft.quickText ?? "");
  const [understood, setUnderstood] = useState<string | null>(null);
  const [hints, setHints] = useState<Awaited<ReturnType<typeof getQuickHints>> | null>(null);
  useEffect(() => {
    if (isEdit || !open || hints) return;
    getQuickHints().then(setHints).catch(() => setHints([]));
  }, [isEdit, open, hints]);

  const applyQuick = (text: string, history = hints ?? []) => {
    if (!text.trim()) return;
    const r = quickParse(text, { today, accounts, cards, categories, history });
    setValue("kind", r.kind);
    if (r.amountCents) setValue("amount", centsToInput(r.amountCents));
    setValue("description", r.description);
    setValue("date", r.date);
    setValue("status", r.status);
    setValue("installments", String(r.installments));
    if (r.paymentMethod) setValue("paymentMethod", r.paymentMethod);
    if (r.kind === "transfer") {
      if (r.fromAccountId) setValue("fromAccountId", r.fromAccountId);
      if (r.toAccountId) setValue("toAccountId", r.toAccountId);
    } else {
      if (r.categoryId) setValue("categoryId", r.categoryId);
      if (r.destination) setValue("accountId", r.destination);
      else if (r.kind === "income" && accountId.startsWith("card:")) setValue("accountId", defaultAccount?.id ?? "");
    }
    const parts = [
      r.kind === "income" ? "receita" : r.kind === "transfer" ? "transferência" : "despesa",
      r.amountCents ? formatBRL(r.amountCents) : "valor não encontrado",
      ...r.understood,
      r.date === today ? "hoje" : formatDateBR(r.date),
    ];
    setUnderstood(parts.join(" · "));
  };
  // frase vinda de fora (ex.: barra rápida do dashboard)
  const [appliedInitial, setAppliedInitial] = useState(false);
  useEffect(() => {
    if (!draft.quickText || appliedInitial || hints === null) return;
    setAppliedInitial(true);
    applyQuick(draft.quickText, hints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.quickText, appliedInitial, hints]);

  const isCard = kind === "expense" && accountId.startsWith("card:");
  const card = isCard ? cards.find((c) => `card:${c.id}` === accountId) : undefined;
  const showRepeat = kind !== "transfer" && (!isEdit || (isRecurringOccurrence && scope === "series"));

  // receita não vai para cartão
  useEffect(() => {
    if (kind !== "expense" && accountId.startsWith("card:")) setValue("accountId", defaultAccount?.id ?? "");
  }, [kind, accountId, defaultAccount?.id, setValue]);

  const kindCategories = useMemo(
    () => categories.filter((c) => c.kind === (kind === "income" ? "income" : "expense") && (!c.archived || c.id === draft.categoryId)),
    [categories, kind, draft.categoryId],
  );

  useEffect(() => {
    if (kind === "transfer") return;
    if (kindCategories.some((c) => c.id === categoryId)) return;
    const last = read(LAST_CAT_KEY(kind));
    const pick = kindCategories.find((c) => c.id === last) ?? kindCategories[0];
    setValue("categoryId", pick?.id ?? "");
  }, [kind, kindCategories, categoryId, setValue]);

  // prévia das parcelas / fatura
  const preview = useMemo(() => {
    if (!card || !isISODate(date)) return null;
    const cents = parseBRL(amount);
    const n = Math.max(1, Math.min(72, Number(installments) || 1));
    if (!cents || cents < n) return null;
    try {
      return previewInstallments(cents, n, date, card);
    } catch {
      return null;
    }
  }, [card, date, amount, installments]);

  const onSubmit = handleSubmit((values) => {
    const category = categories.find((c) => c.id === values.categoryId);
    const description = values.description.trim() || (values.kind === "transfer" ? "Transferência" : category?.name ?? "");
    const common = {
      id: draft.id,
      description,
      amount: values.amount,
      date: values.date,
      status: values.status,
      paidAt: values.status === "paid" ? values.paidAt || values.date : "",
      notes: values.notes,
    };
    const payload =
      values.kind === "transfer"
        ? { kind: "transfer" as const, ...common, fromAccountId: values.fromAccountId, toAccountId: values.toAccountId }
        : {
            kind: values.kind,
            ...common,
            ...(values.accountId.startsWith("card:") ? { status: "paid" as const, paidAt: "" } : {}),
            accountId: values.accountId,
            categoryId: values.categoryId,
            paymentMethod: values.paymentMethod,
            installments: values.accountId.startsWith("card:") ? Number(values.installments) || 1 : 1,
            repeat: showRepeat ? values.repeat : ("none" as const),
            repeatUntil: showRepeat ? values.repeatUntil : "",
            scope: isRecurringOccurrence ? values.scope : ("one" as const),
            source: draft.source ?? "transaction",
            recurringRuleId: draft.recurringRuleId ?? null,
            occurrenceDate: draft.occurrenceDate ?? null,
          };

    const parsed = entrySchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "amount") as keyof FormValues;
        setError(field, { message: issue.message });
        if (["repeat", "repeatUntil", "notes", "paidAt"].includes(field)) setShowMore(true);
      }
      return;
    }

    startTransition(async () => {
      const res = await saveEntry(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (values.kind !== "transfer") {
        write(LAST_CAT_KEY(values.kind), values.categoryId);
        if (!isEdit) write(LAST_DEST_KEY, values.accountId);
      }
      toast.success(res.message ?? "Salvo");
      onOpenChange(false);
    });
  });

  const err = (k: keyof FormValues) => formState.errors[k]?.message;
  const paidLabel = kind === "income" ? "Recebido" : kind === "transfer" ? "Efetivada" : "Pago";
  const pendingLabel = kind === "income" ? "A receber" : kind === "transfer" ? "Agendada" : "A pagar";
  const noAccounts = activeAccounts.filter((a) => !a.archived).length === 0;
  const visibleCards = activeCards.filter((c) => !c.archived || c.id === draft.cardId);

  const title = isEdit
    ? isRecurringOccurrence
      ? "Editar lançamento recorrente"
      : isCardEdit
        ? "Editar compra no cartão"
        : "Editar lançamento"
    : draft.amountCents
      ? "Duplicar lançamento"
      : "Novo lançamento";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        {noAccounts ? (
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">Cadastre sua primeira conta para começar a lançar.</p>
            <Button asChild>
              <a href="/contas?nova=1">Cadastrar conta</a>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {!isEdit && (
              <Segmented<EntryKind>
                ariaLabel="Tipo de lançamento"
                value={kind}
                onChange={(v) => setValue("kind", v)}
                className="w-full"
                options={[
                  { value: "expense", label: "Despesa", className: "text-negative" },
                  { value: "income", label: "Receita", className: "text-positive" },
                  { value: "transfer", label: "Transferência", className: "text-brand" },
                ]}
              />
            )}
            {isEdit && !isCardEdit && draft.kind !== "transfer" && !isRecurringOccurrence && (
              <Segmented<EntryKind>
                ariaLabel="Tipo de lançamento"
                value={kind}
                onChange={(v) => setValue("kind", v)}
                className="w-full"
                options={[
                  { value: "expense", label: "Despesa", className: "text-negative" },
                  { value: "income", label: "Receita", className: "text-positive" },
                ]}
              />
            )}
            {isRecurringOccurrence && (
              <div className="grid gap-1.5 rounded-xl bg-accent/60 p-3">
                <span className="flex items-center gap-1.5 text-xs font-medium text-accent-foreground">
                  <Repeat className="size-3.5" /> Este lançamento se repete. Aplicar a alteração a:
                </span>
                <Segmented<"one" | "series">
                  ariaLabel="Aplicar a"
                  value={scope}
                  onChange={(v) => setValue("scope", v)}
                  size="sm"
                  className="w-full"
                  options={[
                    { value: "one", label: "Só este" },
                    { value: "series", label: "Este e os próximos" },
                  ]}
                />
              </div>
            )}

            {!isEdit && (
              <div className="grid gap-1.5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand" aria-hidden />
                    <Input
                      aria-label="Lançamento por frase"
                      placeholder="Escreva ou fale: gastei 85 de gasolina"
                      value={quick}
                      onChange={(e) => setQuick(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyQuick(quick);
                        }
                      }}
                      className="pl-9"
                      enterKeyHint="go"
                      autoFocus={!draft.quickText && !draft.amountCents}
                    />
                  </div>
                  <MicButton
                    onPartial={setQuick}
                    onFinal={(t) => {
                      setQuick(t);
                      applyQuick(t);
                    }}
                  />
                  <Button type="button" variant="subtle" onClick={() => applyQuick(quick)} disabled={!quick.trim()}>
                    Preencher
                  </Button>
                </div>
                {understood ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    Entendi: <span className="font-medium text-foreground">{understood}</span>. Confira abaixo e salve.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Ou preencha os campos abaixo.</p>
                )}
              </div>
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
                  autoFocus={isEdit || !!draft.amountCents}
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
                  <Field label={kind === "expense" && visibleCards.length ? "Conta ou cartão" : "Conta"} htmlFor="accountId" error={err("accountId")}>
                    <NativeSelect id="accountId" {...register("accountId")}>
                      {!isCardEdit && (
                        <optgroup label="Contas">
                          {activeAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {kind === "expense" && visibleCards.length > 0 && (!isEdit || isCardEdit) && (
                        <optgroup label="Cartões de crédito">
                          {visibleCards.map((c) => (
                            <option key={c.id} value={`card:${c.id}`}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </NativeSelect>
                  </Field>
                  {isCard ? (
                    <Field label="Parcelas" htmlFor="installments" error={err("installments")}>
                      <NativeSelect id="installments" disabled={repeat !== "none" && showRepeat} {...register("installments")}>
                        {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n === 1 ? "À vista (1x)" : `${n}x`}
                          </option>
                        ))}
                        {[30, 36, 48, 60, 72].map((n) => (
                          <option key={n} value={n}>{`${n}x`}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : (
                    <Field label="Forma de pagamento" htmlFor="paymentMethod">
                      <NativeSelect id="paymentMethod" {...register("paymentMethod")}>
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABEL[m]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                </div>
                {isCard && preview && (
                  <p className="-mt-2 flex items-start gap-1.5 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    <CardIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {preview.length > 1 ? (
                        <>
                          {preview.length}x de <strong className="text-foreground">{formatBRL(preview[preview.length - 1].amount)}</strong>
                          {preview[0].amount !== preview[preview.length - 1].amount && <> (1ª de {formatBRL(preview[0].amount)})</>}
                          {" · "}1ª na fatura que vence em {formatDateBR(preview[0].due)}, última em {formatDateBR(preview[preview.length - 1].due)}.
                        </>
                      ) : (
                        <>Entra na fatura que vence em {formatDateBR(preview[0].due)}.</>
                      )}
                    </span>
                  </p>
                )}
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

            <div className={cn("grid gap-3", isCard ? "grid-cols-1" : "grid-cols-2")}>
              <Field
                label={isCard ? "Data da compra" : kind === "transfer" ? "Data" : "Data / vencimento"}
                htmlFor="date"
                error={err("date")}
              >
                <Input id="date" type="date" {...register("date")} />
              </Field>
              {!isCard && (
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
              )}
            </div>

            {showRepeat && isRecurringOccurrence && (
              <RepeatFields register={register} repeat={repeat} isCard={isCard} errRepeat={err("repeat")} errUntil={err("repeatUntil")} />
            )}

            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              className="flex items-center gap-1 justify-self-start text-xs font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={showMore}
            >
              <ChevronDown className={cn("size-3.5 transition", showMore && "rotate-180")} />
              {showRepeat && !isRecurringOccurrence ? "Repetir, observações e mais" : "Mais detalhes"}
              {showRepeat && !isRecurringOccurrence && repeat !== "none" && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
                  <Repeat className="size-3" /> {REPEAT_OPTIONS.find((o) => o.value === repeat)?.label}
                </span>
              )}
            </button>
            {showMore && (
              <div className="grid gap-3">
                {showRepeat && !isRecurringOccurrence && (
                  <RepeatFields register={register} repeat={repeat} isCard={isCard} errRepeat={err("repeat")} errUntil={err("repeatUntil")} />
                )}
                {status === "paid" && !isCard && (
                  <Field
                    label={kind === "income" ? "Recebido em" : "Pago em"}
                    htmlFor="paidAt"
                    error={err("paidAt")}
                    hint="Deixe vazio para usar a mesma data acima. Usado na visão de fluxo de caixa."
                  >
                    <Input id="paidAt" type="date" {...register("paidAt")} />
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

function RepeatFields({
  register,
  repeat,
  isCard,
  errRepeat,
  errUntil,
}: {
  register: ReturnType<typeof useForm<FormValues>>["register"];
  repeat: RepeatValue;
  isCard: boolean;
  errRepeat?: string;
  errUntil?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field
        label="Repetir"
        htmlFor="repeat"
        error={errRepeat}
        hint={repeat !== "none" ? (isCard ? "Cobrança lançada no cartão a cada vencimento." : "As próximas ficam previstas, sem marcar como pagas.") : undefined}
      >
        <NativeSelect id="repeat" {...register("repeat")}>
          {REPEAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {repeat !== "none" && (
        <Field label="Até (opcional)" htmlFor="repeatUntil" error={errUntil}>
          <Input id="repeatUntil" type="date" {...register("repeatUntil")} />
        </Field>
      )}
    </div>
  );
}
