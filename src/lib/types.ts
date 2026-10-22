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
