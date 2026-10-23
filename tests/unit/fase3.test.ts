import { describe, expect, it } from "vitest";
import { averageOf, categoryByMonth, fixedVsVariable, projectBalance, sameDaysPreviousMonth } from "@/lib/finance/reports";
import { buildInsights } from "@/lib/finance/insights";
import { installmentEntry, type Entry } from "@/lib/finance/summary";
import { monthRange } from "@/lib/finance/dates";

const e = (type: Entry["type"], amountCents: number, date: string, categoryId: string, status: Entry["status"] = "paid"): Entry => ({
  type, amountCents, date, status, paidAt: status === "paid" ? date : null, categoryId,
});
const cats = [
  { id: "alim", name: "Alimentação", kind: "expense" as const },
  { id: "mor", name: "Moradia", kind: "expense" as const },
  { id: "lazer", name: "Lazer", kind: "expense" as const },
  { id: "sal", name: "Salário", kind: "income" as const },
];

describe("relatórios", () => {
  const entries: Entry[] = [
    e("expense", 100_000, "2026-08-10", "alim"), e("expense", 150_000, "2026-08-05", "mor"),
    e("expense", 120_000, "2026-09-10", "alim"), e("expense", 150_000, "2026-09-05", "mor"),
    installmentEntry({ amountCents: 30_000, competenceDate: "2026-09-20", categoryId: "lazer" }),
  ];

  it("despesa por categoria e mês, incluindo parcelas do cartão", () => {
    const t = categoryByMonth(entries, ["2026-08", "2026-09"]);
    expect(t.get("alim")).toEqual([100_000, 120_000]);
    expect(t.get("lazer")).toEqual([0, 30_000]);
  });

  it("fixas × variáveis pela marcação da categoria", () => {
    expect(fixedVsVariable(entries, ["2026-08", "2026-09"], new Set(["mor"]))).toEqual([
      { month: "2026-08", fixed: 150_000, variable: 100_000 },
      { month: "2026-09", fixed: 150_000, variable: 150_000 },
    ]);
  });

  it("média ignora meses sem movimento", () => {
    expect(averageOf([0, 100, 300])).toBe(200);
    expect(averageOf([0, 0])).toBeNull();
  });

  it("comparação justa do mês em andamento: mesmos dias do mês anterior", () => {
    expect(sameDaysPreviousMonth(monthRange("2026-03"), "2026-03-31", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(sameDaysPreviousMonth(monthRange("2026-10"), "2026-10-23", "2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-23" });
  });

  it("projeção de saldo: vencidos entram hoje e detecta o primeiro dia negativo", () => {
    const p = projectBalance(
      50_000,
      [
        { date: "2026-10-20", amountCents: -10_000, label: "vencida" },
        { date: "2026-10-25", amountCents: -60_000, label: "aluguel" },
        { date: "2026-10-28", amountCents: 100_000, label: "salário" },
        { date: "2026-12-01", amountCents: -999_999, label: "fora do horizonte" },
      ],
      "2026-10-23",
      "2026-10-31",
    );
    expect(p.points[0]).toEqual({ date: "2026-10-23", balance: 40_000 });
    expect(p.firstNegative).toEqual({ date: "2026-10-25", balance: -20_000 });
    expect(p.min.balance).toBe(-20_000);
    expect(p.end).toBe(80_000);
    expect(p.points).toHaveLength(9);
  });
});

describe("insights (sem inventar conclusões)", () => {
  it("sem histórico, diz que não há base", () => {
    const r = buildInsights({ entries: [], month: "2026-10", today: "2026-10-23", categories: cats });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("no-history");
  });

  it("variação por categoria entre meses fechados, com valores", () => {
    const entries = [
      e("expense", 100_000, "2026-08-10", "alim"),
      e("expense", 115_000, "2026-09-10", "alim"),
      e("expense", 150_000, "2026-08-05", "mor"),
      e("expense", 150_000, "2026-09-05", "mor"),
    ];
    const r = buildInsights({ entries, month: "2026-09", today: "2026-10-23", categories: cats });
    expect(r.map((i) => i.text)).toContain(
      "Seus gastos com Alimentação aumentaram 15% em setembro em relação ao mês anterior (R$ 1.000,00 → R$ 1.150,00).",
    );
    // Moradia não variou: não gera insight
    expect(r.some((i) => i.id === "cat-mor")).toBe(false);
  });

  it("mês em andamento compara com os mesmos dias do mês passado", () => {
    const entries = [
      e("expense", 40_000, "2026-09-05", "lazer"),
      e("expense", 90_000, "2026-09-28", "lazer"), // depois do dia 23: fora da comparação
      e("expense", 60_000, "2026-10-05", "lazer"),
    ];
    const r = buildInsights({ entries, month: "2026-10", today: "2026-10-23", categories: cats });
    const t = r.find((i) => i.id === "cat-lazer")!.text;
    expect(t).toBe("Seus gastos com Lazer aumentaram 50% até hoje em relação ao mesmo período do mês passado (R$ 400,00 → R$ 600,00).");
  });

  it("taxa de poupança, reserva e projeção negativa", () => {
    const entries = [e("income", 500_000, "2026-09-05", "sal"), e("expense", 400_000, "2026-09-10", "alim")];
    const r = buildInsights({
      entries, month: "2026-09", today: "2026-10-23", categories: cats,
      goals: [{ name: "Reserva de emergência", percent: 65.4, kind: "emergency", done: false }],
      projection: { firstNegative: { date: "2026-10-25", balance: -20_000 }, until: "2026-11-30" },
    });
    const texts = r.map((i) => i.text);
    expect(texts).toContain("Você economizou 20% da sua receita em setembro (R$ 1.000,00).");
    expect(texts).toContain('Sua reserva "Reserva de emergência" está em 65% da meta.');
    expect(texts.some((t) => t.includes("fica negativo em 25/10/2026"))).toBe(true);
  });

  it("média dos 3 meses só com 3 meses de histórico", () => {
    const entries = [e("expense", 150_000, "2026-09-10", "alim")];
    const base = { entries, month: "2026-09", today: "2026-10-23", categories: cats };
    expect(buildInsights({ ...base, previousExpenses: [100_000, 100_000] }).some((i) => i.id === "avg")).toBe(false);
    const r = buildInsights({ ...base, previousExpenses: [100_000, 100_000, 100_000] });
    expect(r.find((i) => i.id === "avg")?.text).toBe("Suas despesas em setembro ficaram 50% acima da sua média dos 3 meses anteriores (R$ 1.000,00).");
  });
});
