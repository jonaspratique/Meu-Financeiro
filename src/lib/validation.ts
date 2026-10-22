/**
 * Schemas compartilhados entre o formulário (cliente) e as Server Actions
 * (servidor). O servidor SEMPRE revalida — o cliente só melhora a UX.
 */
import { z } from "zod";
import { isISODate } from "./finance/dates";
import { parseBRL } from "./finance/money";

const MAX_CENTS = 100_000_000_000; // R$ 1 bilhão

export const isoDate = z.string().refine(isISODate, "Data inválida");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : null));

/** Valor digitado ("1.234,56") -> centavos positivos. */
export const positiveMoney = z
  .string()
  .transform((v, ctx) => {
    const cents = parseBRL(v);
    if (cents == null) {
      ctx.addIssue({ code: "custom", message: "Valor inválido" });
      return z.NEVER;
    }
    if (cents <= 0) {
      ctx.addIssue({ code: "custom", message: "Informe um valor maior que zero" });
      return z.NEVER;
    }
    if (cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "Valor muito alto" });
      return z.NEVER;
    }
    return cents;
  });

/** Valor que pode ser negativo ou zero (saldos). */
export const signedMoney = z.string().transform((v, ctx) => {
  const cents = parseBRL(v === "" ? "0" : v);
  if (cents == null || Math.abs(cents) > MAX_CENTS) {
    ctx.addIssue({ code: "custom", message: "Valor inválido" });
    return z.NEVER;
  }
  return cents;
});

const id = z.string().uuid("Selecione uma opção");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida");

export const PAYMENT_METHODS = ["pix", "debit", "cash", "boleto", "bank_transfer", "auto_debit", "other"] as const;

const entryBase = {
  id: z.string().uuid().optional(),
  description: z.string().trim().min(1, "Informe uma descrição").max(120, "Máximo de 120 caracteres"),
  amount: positiveMoney,
  date: isoDate,
  status: z.enum(["paid", "pending"]),
  paidAt: isoDate.optional().or(z.literal("").transform(() => undefined)),
  notes: optionalText(1000),
};

export const entrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("income"),
    ...entryBase,
    accountId: id,
    categoryId: id,
    paymentMethod: z.enum(PAYMENT_METHODS),
  }),
  z.object({
    kind: z.literal("expense"),
    ...entryBase,
    accountId: id,
    categoryId: id,
    paymentMethod: z.enum(PAYMENT_METHODS),
  }),
  z
    .object({
      kind: z.literal("transfer"),
      ...entryBase,
      fromAccountId: id,
      toAccountId: id,
    })
    .refine((v) => v.fromAccountId !== v.toAccountId, {
      message: "Escolha contas diferentes",
      path: ["toAccountId"],
    }),
]);
export type EntryInput = z.input<typeof entrySchema>;
export type EntryParsed = z.output<typeof entrySchema>;

export const refundSchema = z.object({
  refundOfId: id,
  amount: positiveMoney,
  date: isoDate,
  description: z.string().trim().min(1).max(120),
});

export const accountSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe o nome").max(60),
  type: z.enum(["checking", "digital", "cash", "savings", "investment"]),
  isOperational: z.boolean(),
  initialBalance: signedMoney,
  initialBalanceDate: isoDate,
  color,
  isDefault: z.boolean(),
});
export type AccountInput = z.input<typeof accountSchema>;

export const reconcileSchema = z.object({
  accountId: id,
  date: isoDate,
  reportedBalance: signedMoney,
  reason: z.string().trim().min(3, "Explique o motivo do ajuste").max(300),
});

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe o nome").max(40),
  kind: z.enum(["income", "expense"]),
  color,
  isFixed: z.boolean(),
});

export const goalSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe o nome").max(60),
  kind: z.enum(["emergency", "travel", "car", "investments", "projects", "other"]),
  target: positiveMoney,
  targetDate: isoDate.optional().or(z.literal("").transform(() => undefined)),
  color,
});

export const savingsMoveSchema = z.object({
  goalId: id,
  accountId: id,
  kind: z.enum(["deposit", "withdrawal"]),
  amount: positiveMoney,
  date: isoDate,
  notes: optionalText(500),
});

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Dados inválidos";
}
