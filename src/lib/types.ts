import type { ISODate } from "./finance/dates";

export type AccountType = "checking" | "digital" | "cash" | "savings" | "investment";
export type CategoryKind = "income" | "expense";
export type TransactionType = "income" | "expense" | "refund";
export type EntryStatus = "pending" | "paid" | "cancelled";
export type PaymentMethod = "pix" | "debit" | "cash" | "boleto" | "bank_transfer" | "auto_debit" | "other";
export type GoalKind = "emergency" | "travel" | "car" | "investments" | "projects" | "other";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  isOperational: boolean;
  initialBalanceCents: number;
  initialBalanceDate: ISODate;
  color: string;
  icon: string;
  isDefault: boolean;
  archived: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  isFixed: boolean;
  archived: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  description: string;
  amountCents: number;
  date: ISODate;
  status: EntryStatus;
  paidAt: ISODate | null;
  accountId: string;
  categoryId: string | null;
  paymentMethod: PaymentMethod;
  notes: string | null;
  refundOfId: string | null;
  createdAt: string;
  recurringRuleId: string | null;
  occurrenceDate: ISODate | null;
  recurrenceDetached: boolean;
}

export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: ISODate;
  status: EntryStatus;
  paidAt: ISODate | null;
  description: string;
  notes: string | null;
  createdAt: string;
}

export interface Adjustment {
  id: string;
  accountId: string;
  date: ISODate;
  amountCents: number;
  reason: string;
  systemBalanceCents: number;
  reportedBalanceCents: number;
  createdAt: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  kind: GoalKind;
  targetCents: number;
  targetDate: ISODate | null;
  color: string;
  icon: string;
  archived: boolean;
}

export interface SavingsMovement {
  id: string;
  goalId: string;
  accountId: string;
  kind: "deposit" | "withdrawal";
  amountCents: number;
  date: ISODate;
  notes: string | null;
}

/* ------------------------------ Fase 2 ------------------------------ */
export type CardEntryKind = "purchase" | "refund" | "fee" | "credit";
export type Frequency = "weekly" | "monthly" | "yearly";

export interface CreditCard {
  id: string;
  name: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  paymentAccountId: string | null;
  color: string;
  icon: string;
  archived: boolean;
}

/** Compra/estorno/ajuste no cartão. `date` e `status` existem para listas mistas. */
export interface CardPurchase {
  id: string;
  cardId: string;
  kind: CardEntryKind;
  description: string;
  totalCents: number;
  purchaseDate: ISODate;
  date: ISODate;
  status: "paid";
  installments: number;
  categoryId: string;
  refundOfId: string | null;
  recurringRuleId: string | null;
  occurrenceDate: ISODate | null;
  notes: string | null;
  createdAt: string;
}

export interface CardInstallment {
  id: string;
  purchaseId: string;
  cardId: string;
  statementId: string;
  number: number;
  totalNumber: number;
  amountCents: number;
  competenceDate: ISODate;
  /** dados da compra (embutidos na consulta) */
  purchase?: { description: string; kind: CardEntryKind; categoryId: string; purchaseDate: ISODate; totalCents: number; installments: number };
}

export interface StatementTotals {
  statementId: string;
  cardId: string;
  month: string; // "2026-11"
  closingDate: ISODate;
  dueDate: ISODate;
  chargesCents: number;
  creditsCents: number;
  paymentsCents: number;
}

export interface StatementPayment {
  id: string;
  statementId: string;
  accountId: string;
  amountCents: number;
  date: ISODate;
  status: "paid";
  description: string;
  notes: string | null;
  createdAt: string;
  cardId?: string;
}

export interface RecurringRule {
  id: string;
  type: "income" | "expense";
  description: string;
  amountCents: number;
  categoryId: string;
  accountId: string | null;
  cardId: string | null;
  paymentMethod: PaymentMethod;
  frequency: Frequency;
  intervalCount: number;
  startDate: ISODate;
  endDate: ISODate | null;
  generatedUntil: ISODate | null;
  notes: string | null;
}

export interface Budget {
  id: string;
  month: string; // "2026-10"
  categoryId: string;
  amountCents: number;
}

/* ------------------------- mapeamento das linhas ------------------------ */
/* bigint chega do PostgREST como number (valores < 2^53, garantido pelos CHECKs). */
type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? null : String(v));

export const mapAccount = (r: Row): Account => ({
  id: String(r.id),
  name: String(r.name),
  type: r.type as AccountType,
  isOperational: Boolean(r.is_operational),
  initialBalanceCents: n(r.initial_balance_cents),
  initialBalanceDate: String(r.initial_balance_date),
  color: String(r.color),
  icon: String(r.icon),
  isDefault: Boolean(r.is_default),
  archived: r.archived_at != null,
});

export const mapCategory = (r: Row): Category => ({
  id: String(r.id),
  name: String(r.name),
  kind: r.kind as CategoryKind,
  color: String(r.color),
  icon: String(r.icon),
  isFixed: Boolean(r.is_fixed),
  archived: r.archived_at != null,
});

export const mapTransaction = (r: Row): Transaction => ({
  id: String(r.id),
  type: r.type as TransactionType,
  description: String(r.description),
  amountCents: n(r.amount_cents),
  date: String(r.date),
  status: r.status as EntryStatus,
  paidAt: s(r.paid_at),
  accountId: String(r.account_id),
  categoryId: s(r.category_id),
  paymentMethod: r.payment_method as PaymentMethod,
  notes: s(r.notes),
  refundOfId: s(r.refund_of_id),
  createdAt: String(r.created_at),
  recurringRuleId: s(r.recurring_rule_id),
  occurrenceDate: s(r.occurrence_date),
  recurrenceDetached: Boolean(r.recurrence_detached),
});

export const mapTransfer = (r: Row): Transfer => ({
  id: String(r.id),
  fromAccountId: String(r.from_account_id),
  toAccountId: String(r.to_account_id),
  amountCents: n(r.amount_cents),
  date: String(r.date),
  status: r.status as EntryStatus,
  paidAt: s(r.paid_at),
  description: String(r.description),
  notes: s(r.notes),
  createdAt: String(r.created_at),
});

export const mapAdjustment = (r: Row): Adjustment => ({
  id: String(r.id),
  accountId: String(r.account_id),
  date: String(r.date),
  amountCents: n(r.amount_cents),
  reason: String(r.reason),
  systemBalanceCents: n(r.system_balance_cents),
  reportedBalanceCents: n(r.reported_balance_cents),
  createdAt: String(r.created_at),
});

export const mapGoal = (r: Row): SavingsGoal => ({
  id: String(r.id),
  name: String(r.name),
  kind: r.kind as GoalKind,
  targetCents: n(r.target_cents),
  targetDate: s(r.target_date),
  color: String(r.color),
  icon: String(r.icon),
  archived: r.archived_at != null,
});

export const mapMovement = (r: Row): SavingsMovement => ({
  id: String(r.id),
  goalId: String(r.goal_id),
  accountId: String(r.account_id),
  kind: r.kind as "deposit" | "withdrawal",
  amountCents: n(r.amount_cents),
  date: String(r.date),
  notes: s(r.notes),
});

export const mapCard = (r: Row): CreditCard => ({
  id: String(r.id),
  name: String(r.name),
  limitCents: n(r.limit_cents),
  closingDay: n(r.closing_day),
  dueDay: n(r.due_day),
  paymentAccountId: s(r.payment_account_id),
  color: String(r.color),
  icon: String(r.icon),
  archived: r.archived_at != null,
});

export const mapCardPurchase = (r: Row): CardPurchase => ({
  id: String(r.id),
  cardId: String(r.card_id),
  kind: r.kind as CardEntryKind,
  description: String(r.description),
  totalCents: n(r.total_cents),
  purchaseDate: String(r.purchase_date),
  date: String(r.purchase_date),
  status: "paid",
  installments: n(r.installments),
  categoryId: String(r.category_id),
  refundOfId: s(r.refund_of_id),
  recurringRuleId: s(r.recurring_rule_id),
  occurrenceDate: s(r.occurrence_date),
  notes: s(r.notes),
  createdAt: String(r.created_at),
});

export const mapInstallment = (r: Row): CardInstallment => {
  const p = r.credit_card_purchases as Row | null | undefined;
  return {
    id: String(r.id),
    purchaseId: String(r.purchase_id),
    cardId: String(r.card_id),
    statementId: String(r.statement_id),
    number: n(r.number),
    totalNumber: n(r.total_number),
    amountCents: n(r.amount_cents),
    competenceDate: String(r.competence_date),
    purchase: p
      ? {
          description: String(p.description),
          kind: p.kind as CardEntryKind,
          categoryId: String(p.category_id),
          purchaseDate: String(p.purchase_date),
          totalCents: n(p.total_cents),
          installments: n(p.installments),
        }
      : undefined,
  };
};

export const mapStatementTotals = (r: Row): StatementTotals => ({
  statementId: String(r.statement_id),
  cardId: String(r.card_id),
  month: String(r.month).slice(0, 7),
  closingDate: String(r.closing_date),
  dueDate: String(r.due_date),
  chargesCents: n(r.charges_cents),
  creditsCents: n(r.credits_cents),
  paymentsCents: n(r.payments_cents),
});

export const mapStatementPayment = (r: Row): StatementPayment => {
  const st = r.credit_card_statements as Row | null | undefined;
  return {
    id: String(r.id),
    statementId: String(r.statement_id),
    accountId: String(r.account_id),
    amountCents: n(r.amount_cents),
    date: String(r.date),
    status: "paid",
    description: "Pagamento de fatura",
    notes: s(r.notes),
    createdAt: String(r.created_at),
    cardId: st ? String(st.card_id) : undefined,
  };
};

export const mapRule = (r: Row): RecurringRule => ({
  id: String(r.id),
  type: r.type as "income" | "expense",
  description: String(r.description),
  amountCents: n(r.amount_cents),
  categoryId: String(r.category_id),
  accountId: s(r.account_id),
  cardId: s(r.card_id),
  paymentMethod: r.payment_method as PaymentMethod,
  frequency: r.frequency as Frequency,
  intervalCount: n(r.interval_count),
  startDate: String(r.start_date),
  endDate: s(r.end_date),
  generatedUntil: s(r.generated_until),
  notes: s(r.notes),
});

export const mapBudget = (r: Row): Budget => ({
  id: String(r.id),
  month: String(r.month).slice(0, 7),
  categoryId: String(r.category_id),
  amountCents: n(r.amount_cents),
});

/* ------------------------------- rótulos ------------------------------- */
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Conta corrente",
  digital: "Conta digital",
  cash: "Dinheiro",
  savings: "Poupança",
  investment: "Investimento",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  debit: "Débito",
  cash: "Dinheiro",
  boleto: "Boleto",
  bank_transfer: "Transferência/TED",
  auto_debit: "Débito automático",
  other: "Outro",
};

export const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  emergency: "Reserva de emergência",
  travel: "Viagem",
  car: "Compra de carro",
  investments: "Investimentos",
  projects: "Projetos pessoais",
  other: "Outros",
};

export const GOAL_KIND_ICON: Record<GoalKind, string> = {
  emergency: "shield",
  travel: "plane",
  car: "car",
  investments: "trending-up",
  projects: "rocket",
  other: "piggy-bank",
};

export const ACCOUNT_TYPE_ICON: Record<AccountType, string> = {
  checking: "landmark",
  digital: "smartphone",
  cash: "banknote",
  savings: "piggy-bank",
  investment: "trending-up",
};

export function statusLabel(type: TransactionType | "transfer", status: EntryStatus) {
  if (status === "cancelled") return "Cancelado";
  if (status === "pending") return type === "income" ? "A receber" : type === "transfer" ? "Agendada" : "A pagar";
  return type === "income" ? "Recebido" : type === "refund" ? "Estornado" : type === "transfer" ? "Efetivada" : "Pago";
}

/** Opções de repetição exibidas no formulário. */
export const REPEAT_OPTIONS = [
  { value: "none", label: "Não repete" },
  { value: "weekly-1", label: "Toda semana" },
  { value: "weekly-2", label: "A cada 2 semanas" },
  { value: "monthly-1", label: "Todo mês" },
  { value: "monthly-2", label: "A cada 2 meses" },
  { value: "monthly-3", label: "A cada 3 meses" },
  { value: "monthly-6", label: "A cada 6 meses" },
  { value: "yearly-1", label: "Todo ano" },
] as const;
export type RepeatValue = (typeof REPEAT_OPTIONS)[number]["value"];

export function repeatLabel(frequency: Frequency, interval: number) {
  return REPEAT_OPTIONS.find((o) => o.value === `${frequency}-${interval}`)?.label ?? `A cada ${interval} ${frequency === "weekly" ? "semanas" : frequency === "monthly" ? "meses" : "anos"}`;
}

export const CARD_KIND_LABEL: Record<CardEntryKind, string> = {
  purchase: "Compra",
  refund: "Estorno",
  fee: "Tarifa/juros",
  credit: "Crédito/ajuste",
};

/** Categoria virtual "Fatura do cartão" (visão de caixa). */
export const CARD_PAYMENT_PSEUDO_CATEGORY: Category = {
  id: "__fatura_cartao__",
  name: "Fatura do cartão",
  kind: "expense",
  color: "#6366f1",
  icon: "credit-card",
  isFixed: false,
  archived: false,
};
