"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Account, Category, CreditCard, PaymentMethod, RecurringRule, RepeatValue } from "@/lib/types";
import { EntryDialog } from "./entry-dialog";

export type EntryKind = "income" | "expense" | "transfer";

/** Dados para abrir o formulário já preenchido (edição ou duplicação). */
export interface EntryDraft {
  kind: EntryKind;
  id?: string;
  description?: string;
  amountCents?: number;
  date?: string;
  status?: "paid" | "pending";
  paidAt?: string | null;
  accountId?: string;
  categoryId?: string | null;
  paymentMethod?: PaymentMethod;
  fromAccountId?: string;
  toAccountId?: string;
  notes?: string | null;
  /** origem do lançamento editado */
  source?: "transaction" | "card";
  cardId?: string;
  installments?: number;
  recurringRuleId?: string | null;
  occurrenceDate?: string | null;
  repeat?: RepeatValue;
  repeatUntil?: string | null;
}

interface Ctx {
  openNew: (kind?: EntryKind) => void;
  openDraft: (draft: EntryDraft) => void;
  accounts: Account[];
  categories: Category[];
  cards: CreditCard[];
  rules: RecurringRule[];
}

const EntryContext = createContext<Ctx | null>(null);

export function useEntryDialog() {
  const ctx = useContext(EntryContext);
  if (!ctx) throw new Error("useEntryDialog fora do EntryProvider");
  return ctx;
}

export function EntryProvider({
  accounts,
  categories,
  cards,
  rules,
  children,
}: {
  accounts: Account[];
  categories: Category[];
  cards: CreditCard[];
  rules: RecurringRule[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EntryDraft>({ kind: "expense" });
  const [nonce, setNonce] = useState(0);

  const openDraft = useCallback((d: EntryDraft) => {
    setDraft(d);
    setNonce((n) => n + 1); // remonta o formulário com os novos valores
    setOpen(true);
  }, []);
  const openNew = useCallback((kind: EntryKind = "expense") => openDraft({ kind }), [openDraft]);

  // Atalho de teclado: "N" abre um novo lançamento
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      openNew();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNew]);

  const value = useMemo(
    () => ({ openNew, openDraft, accounts, categories, cards, rules }),
    [openNew, openDraft, accounts, categories, cards, rules],
  );

  return (
    <EntryContext.Provider value={value}>
      {children}
      <EntryDialog key={nonce} open={open} onOpenChange={setOpen} draft={draft} accounts={accounts} categories={categories} cards={cards} />
    </EntryContext.Provider>
  );
}
