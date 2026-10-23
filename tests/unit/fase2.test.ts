import { describe, expect, it } from "vitest";
import {
  addMonthsClamped, previewInstallments, splitInstallments, statementBalance, statementDates, statementMonth, statementState,
} from "@/lib/finance/cards";
import { budgetStatus } from "@/lib/finance/budgets";
import { monthRange } from "@/lib/finance/dates";
import {
  CARD_PAYMENT_CATEGORY, installmentEntry, statementPaymentEntry, summarize, type Entry,
} from "@/lib/finance/summary";
import { computeOverview } from "@/lib/finance/overview";

describe("cartão: fatura de cada compra (mesmos casos do teste de banco)", () => {
  it.each([
    ["2026-10-04", 5, 12, "2026-10", "2026-10-05", "2026-10-12"],
    ["2026-10-05", 5, 12, "2026-11", "2026-11-05", "2026-11-12"],
    ["2026-10-24", 25, 5, "2026-10", "2026-10-25", "2026-11-05"],
    ["2026-10-30", 25, 5, "2026-11", "2026-11-25", "2026-12-05"],
    ["2026-02-27", 31, 8, "2026-02", "2026-02-28", "2026-03-08"],
    ["2026-12-20", 15, 22, "2027-01", "2027-01-15", "2027-01-22"],
  ])("compra em %s (fecha %i, vence %i)", (date, closing, due, month, closingDate, dueDate) => {
    const m = statementMonth(date, closing);
    expect(m).toBe(month);
    expect(statementDates(m, closing, due)).toEqual({ closing: closingDate, due: dueDate });
  });
});

describe("cartão: parcelas", () => {
  it("soma exata com centavos na 1ª parcela", () => {
    expect(splitInstallments(120_000, 6)).toEqual([20_000, 20_000, 20_000, 20_000, 20_000, 20_000]);
    expect(splitInstallments(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
    for (const [t, n] of [[99_999, 12], [1, 1], [7, 7], [100_001, 72]]) {
      expect(splitInstallments(t, n).reduce((a, b) => a + b, 0)).toBe(t);
    }
    expect(() => splitInstallments(5, 6)).toThrow();
  });

  it("prévia: competência mês a mês e vencimentos de cada fatura", () => {
    const p = previewInstallments(120_000, 3, "2026-10-20", { closingDay: 5, dueDay: 12 });
    expect(p).toEqual([
      { number: 1, amount: 40_000, competence: "2026-10-20", month: "2026-11", due: "2026-11-12" },
      { number: 2, amount: 40_000, competence: "2026-11-20", month: "2026-12", due: "2026-12-12" },
      { number: 3, amount: 40_000, competence: "2026-12-20", month: "2027-01", due: "2027-01-12" },
    ]);
    expect([0, 1, 2].map((k) => addMonthsClamped("2026-01-31", k))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("situação da fatura", () => {
    const t = { closingDate: "2026-11-05", dueDate: "2026-11-12", chargesCents: 20_000, creditsCents: 0, paymentsCents: 0 };
    expect(statementState(t, "2026-11-01")).toBe("open");
    expect(statementState(t, "2026-11-05")).toBe("closed");
    expect(statementState(t, "2026-11-13")).toBe("overdue");
    expect(statementState({ ...t, paymentsCents: 15_000 }, "2026-11-13")).toBe("overdue");
    expect(statementBalance({ ...t, paymentsCents: 15_000 })).toBe(5_000);
    expect(statementState({ ...t, paymentsCents: 20_000 }, "2026-11-13")).toBe("paid");
    expect(statementState({ ...t, creditsCents: 25_000 }, "2026-11-13")).toBe("credit");
    expect(statementState({ ...t, chargesCents: 0 }, "2026-11-13")).toBe("empty");
  });
});

describe("cartão no resumo do mês (sem dupla contagem)", () => {
  const oct = monthRange("2026-10");
  const nov = monthRange("2026-11");
  const entries: Entry[] = [
    // compra de R$ 300 em 3x em 20/10 (Lazer) e estorno de R$ 50 em 25/10
    installmentEntry({ amountCents: 10_000, competenceDate: "2026-10-20", categoryId: "lazer" }),
    installmentEntry({ amountCents: 10_000, competenceDate: "2026-11-20", categoryId: "lazer" }),
    installmentEntry({ amountCents: 10_000, competenceDate: "2026-12-20", categoryId: "lazer" }),
    installmentEntry({ amountCents: -5_000, competenceDate: "2026-10-25", categoryId: "lazer" }),
    // pagamento da 1ª fatura em novembro
    statementPaymentEntry({ amountCents: 5_000, date: "2026-11-12" }),
  ];

  it("competência: parcelas por categoria; pagamento não conta", () => {
    const s = summarize(entries, oct, "competencia");
    expect(s.expense).toBe(5_000);
    expect(s.expenseByCategory.get("lazer")).toBe(5_000);
    expect(summarize(entries, nov, "competencia").expense).toBe(10_000);
    expect(summarize(entries, nov, "competencia").expenseByCategory.has(CARD_PAYMENT_CATEGORY)).toBe(false);
  });

  it("caixa: só o pagamento da fatura, na categoria 'fatura do cartão'", () => {
    expect(summarize(entries, oct, "caixa").expense).toBe(0);
    const s = summarize(entries, nov, "caixa");
    expect(s.expense).toBe(5_000);
    expect(s.expenseByCategory.get(CARD_PAYMENT_CATEGORY)).toBe(5_000);
  });

  it("patrimônio desconta a dívida do cartão; disponível não usa limite", () => {
    const o = computeOverview([{ id: "c", isOperational: true }], [{ accountId: "c", balanceCents: 100_000, reservedCents: 0 }], 25_000);
    expect(o.available).toBe(100_000);
    expect(o.netWorth).toBe(75_000);
  });
});

describe("orçamentos", () => {
  it("avisos em 80% e 100%", () => {
    expect(budgetStatus(120_000, 50_000)).toMatchObject({ level: "ok", available: 70_000 });
    expect(budgetStatus(120_000, 96_000)).toMatchObject({ level: "warning", percent: 80 });
    expect(budgetStatus(120_000, 120_000).level).toBe("over");
    expect(budgetStatus(120_000, 150_000)).toMatchObject({ level: "over", available: -30_000 });
    expect(budgetStatus(120_000, -1_000)).toMatchObject({ spent: 0, level: "ok" });
  });
});
