import { describe, expect, it } from "vitest";
import { centsToInput, formatBRL, parseBRL } from "@/lib/finance/money";
import {
  addDays, formatDateBR, formatMonthLong, lastMonths, monthDiff, monthRange,
  parseDateBR, parseMonthParam, shiftMonth, todayISO,
} from "@/lib/finance/dates";
import { monthlySeries, percentChange, savingsRate, summarize, topCategories, type Entry } from "@/lib/finance/summary";
import { computeOverview } from "@/lib/finance/overview";
import { goalProgress, reservesSeries } from "@/lib/finance/savings";

describe("money", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1234.56", 123456],
    ["R$ 85", 8500],
    ["85,5", 8550],
    ["0,01", 1],
    ["1.234", 123400],
    ["1.234.567,89", 123456789],
    ["1,234.56", 123456],
    ["-10,00", -1000],
    [",50", 50],
  ])("parseBRL(%s) = %i", (input, cents) => {
    expect(parseBRL(input)).toBe(cents);
  });

  it.each(["", "abc", "1,2,3", "12,345", "1.2.3,4.5", "R$"])("parseBRL(%s) inválido", (input) => {
    expect(parseBRL(input)).toBeNull();
  });

  it("formata em reais", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(-500)).toBe("-R$ 5,00");
    expect(centsToInput(123456)).toBe("1.234,56");
    expect(centsToInput(5)).toBe("0,05");
  });

  it("ida e volta input <-> centavos é estável", () => {
    for (const c of [0, 1, 99, 100, 123456, 987654321]) expect(parseBRL(centsToInput(c))).toBe(c);
  });
});

describe("datas", () => {
  it("hoje no fuso de São Paulo (servidor em UTC)", () => {
    // 21/10/2026 01:30 UTC ainda é 20/10 em São Paulo (UTC-3)
    expect(todayISO(new Date("2026-10-21T01:30:00Z"))).toBe("2026-10-20");
    expect(todayISO(new Date("2026-10-21T03:30:00Z"))).toBe("2026-10-21");
  });

  it("navegação entre meses", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", -13)).toBe("2025-09");
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(monthDiff("2026-10", "2027-03")).toBe(5);
  });

  it("intervalo do mês considera anos bissextos", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-02").to).toBe("2026-02-28");
  });

  it("parâmetro de mês inválido cai no mês atual", () => {
    expect(parseMonthParam("2026-13", "2026-10-21")).toBe("2026-10");
    expect(parseMonthParam("lixo", "2026-10-21")).toBe("2026-10");
    expect(parseMonthParam("2025-03", "2026-10-21")).toBe("2025-03");
  });

  it("formatos brasileiros", () => {
    expect(formatDateBR("2026-10-21")).toBe("21/10/2026");
    expect(parseDateBR("31/02/2026")).toBeNull();
    expect(parseDateBR("29/02/2028")).toBe("2028-02-29");
    expect(formatMonthLong("2026-03")).toBe("Março de 2026");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

const oct = monthRange("2026-10");
const e = (p: Partial<Entry> & Pick<Entry, "type" | "amountCents" | "date">): Entry => ({
  status: "paid",
  paidAt: p.status === "pending" || p.status === "cancelled" ? null : p.date,
  categoryId: "cat",
  ...p,
});

describe("resumo do período", () => {
  const entries: Entry[] = [
    e({ type: "income", amountCents: 500_000, date: "2026-10-05", categoryId: "salario" }),
    e({ type: "income", amountCents: 80_000, date: "2026-10-25", status: "pending", categoryId: "freela" }),
    e({ type: "expense", amountCents: 150_000, date: "2026-10-10", categoryId: "moradia" }),
    e({ type: "expense", amountCents: 30_000, date: "2026-10-30", status: "pending", categoryId: "lazer" }),
    e({ type: "expense", amountCents: 99_999, date: "2026-10-12", status: "cancelled", categoryId: "lazer" }),
    // competência em setembro, pago em outubro
    e({ type: "expense", amountCents: 20_000, date: "2026-09-28", paidAt: "2026-10-02", categoryId: "mercado" }),
    // competência em outubro, pago em novembro
    e({ type: "expense", amountCents: 7_000, date: "2026-10-31", paidAt: "2026-11-01", categoryId: "mercado" }),
    e({ type: "refund", amountCents: 50_000, date: "2026-10-15", categoryId: "moradia" }),
  ];

  it("competência: data do lançamento, inclui pendentes, ignora cancelados", () => {
    const s = summarize(entries, oct, "competencia");
    expect(s.income).toBe(580_000);
    expect(s.expense).toBe(150_000 + 30_000 + 7_000 - 50_000);
    expect(s.refunds).toBe(50_000);
    expect(s.result).toBe(580_000 - 137_000);
    expect(s.pendingIncome).toBe(80_000);
    expect(s.pendingExpense).toBe(30_000);
    expect(s.expenseByCategory.get("moradia")).toBe(100_000);
    expect(s.expenseByCategory.get("mercado")).toBe(7_000);
  });

  it("caixa: data de pagamento, somente efetivados", () => {
    const s = summarize(entries, oct, "caixa");
    expect(s.income).toBe(500_000);
    expect(s.expense).toBe(150_000 + 20_000 - 50_000);
    expect(s.expenseByCategory.get("mercado")).toBe(20_000);
    expect(s.pendingExpense).toBe(0);
  });

  it("nenhum lançamento é contado em dois meses no mesmo regime", () => {
    const months = lastMonths("2026-11", 3);
    for (const regime of ["competencia", "caixa"] as const) {
      const series = monthlySeries(entries, months, regime);
      const totalExpense = series.reduce((a, p) => a + p.expense, 0);
      const expected = regime === "competencia"
        ? 150_000 + 30_000 + 20_000 + 7_000 - 50_000
        : 150_000 + 20_000 + 7_000 - 50_000; // a pendente não saiu do caixa
      expect(totalExpense).toBe(expected);
    }
  });

  it("indicadores comparativos não inventam números sem base", () => {
    expect(percentChange(115, 100)).toBeCloseTo(15);
    expect(percentChange(100, 0)).toBeNull();
    expect(savingsRate({ income: 0, result: -10 })).toBeNull();
    expect(savingsRate({ income: 1000, result: 200 })).toBe(20);
  });

  it("ranking de categorias descarta categorias zeradas por estorno", () => {
    const m = new Map([["a", 0], ["b", 500], ["c", 1500], ["d", -10]]);
    expect(topCategories(m)).toEqual([{ categoryId: "c", amount: 1500 }, { categoryId: "b", amount: 500 }]);
  });
});

describe("visão geral (sem dupla contagem)", () => {
  it("reservas ficam dentro do saldo; disponível exclui reservado e não operacionais", () => {
    const accounts = [
      { id: "corrente", isOperational: true },
      { id: "poupanca", isOperational: false },
      { id: "futura", isOperational: true },
    ];
    const balances = [
      { accountId: "corrente", balanceCents: 300_000, reservedCents: 100_000 },
      { accountId: "poupanca", balanceCents: 500_000, reservedCents: 500_000 },
    ];
    const o = computeOverview(accounts, balances);
    expect(o.totalBalance).toBe(800_000);
    expect(o.reserved).toBe(600_000);
    expect(o.available).toBe(200_000);
    expect(o.netWorth).toBe(800_000); // NÃO 1.400.000
    expect(o.overAllocatedAccountIds).toEqual([]);
  });

  it("sinaliza conta com reserva maior que o saldo", () => {
    const o = computeOverview([{ id: "x", isOperational: true }], [{ accountId: "x", balanceCents: 50, reservedCents: 100 }], 0);
    expect(o.available).toBe(-50);
    expect(o.overAllocatedAccountIds).toEqual(["x"]);
  });

  it("dívidas reduzem o patrimônio", () => {
    expect(computeOverview([{ id: "x", isOperational: true }], [{ accountId: "x", balanceCents: 1000, reservedCents: 0 }], 300).netWorth).toBe(700);
  });
});

describe("reservas", () => {
  const goal = { id: "g", targetCents: 1_200_000, targetDate: "2027-03-15" };
  const moves = [
    { goalId: "g", kind: "deposit" as const, amountCents: 300_000, date: "2026-08-01" },
    { goalId: "g", kind: "deposit" as const, amountCents: 200_000, date: "2026-09-01" },
    { goalId: "g", kind: "withdrawal" as const, amountCents: 50_000, date: "2026-10-05" },
    { goalId: "outra", kind: "deposit" as const, amountCents: 999_999, date: "2026-10-05" },
  ];

  it("progresso e aporte mensal sugerido", () => {
    const p = goalProgress(goal, moves, "2026-10-21");
    expect(p.saved).toBe(450_000);
    expect(p.remaining).toBe(750_000);
    expect(p.percent).toBeCloseTo(37.5);
    expect(p.monthsLeft).toBe(6); // out, nov, dez, jan, fev, mar
    expect(p.suggestedMonthly).toBe(125_000);
    expect(p.overdue).toBe(false);
  });

  it("arredonda o aporte sugerido para cima", () => {
    const p = goalProgress({ id: "g", targetCents: 1000, targetDate: "2026-12-01" }, [], "2026-10-01");
    expect(p.suggestedMonthly).toBe(334); // 3 × 334 ≥ 1000
  });

  it("meta vencida e meta sem prazo", () => {
    expect(goalProgress({ ...goal, targetDate: "2026-01-01" }, moves, "2026-10-21").overdue).toBe(true);
    expect(goalProgress({ ...goal, targetDate: null }, moves, "2026-10-21").suggestedMonthly).toBeNull();
  });

  it("evolução mensal é cumulativa", () => {
    const s = reservesSeries(moves.filter((m) => m.goalId === "g"), ["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(s.map((p) => p.total)).toEqual([0, 300_000, 500_000, 450_000]);
  });
});
