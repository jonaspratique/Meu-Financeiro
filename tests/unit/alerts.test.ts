import { describe, expect, it } from "vitest";
import { addDaysISO, brl, buildAlerts, type AlertInput } from "@/lib/finance/alerts";

const accounts = [
  { id: "itau", name: "Itaú" },
  { id: "sant", name: "Santander Select" },
  { id: "inter", name: "Inter" },
];
const base = (over: Partial<AlertInput> = {}): AlertInput => ({
  today: "2026-11-09",
  accounts,
  balances: [
    { accountId: "itau", balanceCents: 500_000, reservedCents: 0 },
    { accountId: "sant", balanceCents: 1_988, reservedCents: 0 },
    { accountId: "inter", balanceCents: 1_000_000, reservedCents: 300_000 },
  ],
  pending: [],
  statements: [],
  ...over,
});

describe("utilitários dos avisos", () => {
  it("formata reais e soma dias", () => {
    expect(brl(2_702_396)).toBe("R$ 27.023,96");
    expect(brl(-15)).toBe("-R$ 0,15");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("avisos do dia", () => {
  it("sem nada pendente, nenhum aviso", () => {
    expect(buildAlerts(base())).toEqual([]);
  });

  it("fatura vence amanhã e o saldo não cobre: diz quanto falta e de onde transferir", () => {
    const r = buildAlerts(
      base({ statements: [{ id: "s1", cardId: "c1", cardName: "Santander Elite", paymentAccountId: "sant", dueDate: "2026-11-10", remainingCents: 159_455 }] }),
    );
    expect(r).toHaveLength(1); // não repete o mesmo problema como "saldo não cobre"
    expect(r[0]).toMatchObject({ kind: "statement-due", severity: "danger", title: "Fatura Santander Elite vence amanhã", url: "/cartoes/c1" });
    expect(r[0].body).toBe(
      "R$ 1.594,55, paga pela conta Santander Select. O saldo não cobre: faltam R$ 1.574,67. Dá para transferir de Inter (R$ 7.000,00) e Itaú (R$ 5.000,00).",
    );
  });

  it("fatura vence amanhã com saldo suficiente: aviso simples", () => {
    const r = buildAlerts(
      base({ statements: [{ id: "s2", cardId: "c2", cardName: "Nubank", paymentAccountId: "itau", dueDate: "2026-11-10", remainingCents: 13_840 }] }),
    );
    expect(r[0]).toMatchObject({ severity: "warning" });
    expect(r[0].body).toBe("R$ 138,40, paga pela conta Itaú. Saldo disponível na conta: R$ 5.000,00.");
  });

  it("saldo não cobre nos próximos 3 dias, considerando receitas que entram antes", () => {
    const r = buildAlerts(
      base({
        today: "2026-11-08",
        pending: [
          { id: "t1", type: "income", amountCents: 2_439_936, date: "2026-11-09", accountId: "itau", description: "Reembolso" },
          { id: "t2", type: "expense", amountCents: 40_000, date: "2026-11-11", accountId: "itau", description: "Condomínio" },
        ],
        statements: [
          { id: "s3", cardId: "c3", cardName: "Itaú Latam Pass", paymentAccountId: "itau", dueDate: "2026-11-09", remainingCents: 2_702_396 },
          { id: "s4", cardId: "c4", cardName: "Carrefour", paymentAccountId: "itau", dueDate: "2026-11-11", remainingCents: 330_105 },
        ],
      }),
    );
    const sf = r.find((a) => a.kind === "shortfall")!;
    // 5.000 + 24.399,36 − 27.023,96 = 2.375,40 (ok no dia 9); dia 11: − 3.301,05 − 400 = −1.325,65
    expect(sf.title).toBe("Saldo do Itaú não cobre o que vence em 11/11");
    expect(sf.body).toContain("Faltam R$ 1.325,65");
    expect(sf.body).toContain("fatura Itaú Latam Pass, fatura Carrefour e Condomínio");
    expect(sf.key).toBe("shortfall:itau:2026-11-11");
    // a fatura do Itaú (vence amanhã) também avisa, sem falta de saldo
    expect(r.find((a) => a.kind === "statement-due")!.severity).toBe("warning");
  });

  it("despesa atrasada pesa no saldo de hoje; receita atrasada não conta", () => {
    const r = buildAlerts(
      base({
        balances: [{ accountId: "itau", balanceCents: 10_000, reservedCents: 0 }],
        pending: [
          { id: "a", type: "expense", amountCents: 15_000, date: "2026-11-05", accountId: "itau", description: "Boleto atrasado" },
          { id: "b", type: "income", amountCents: 99_000, date: "2026-11-07", accountId: "itau", description: "Pix atrasado" },
        ],
      }),
    );
    expect(r.find((a) => a.kind === "shortfall")!.title).toBe("Saldo do Itaú não cobre o que vence hoje");
    expect(r.find((a) => a.kind === "income-expected")!.title).toBe("Pix atrasado ainda não marcado como recebido");
  });

  it("contas a pagar amanhã num aviso só", () => {
    const r = buildAlerts(
      base({
        pending: [
          { id: "x", type: "expense", amountCents: 40_000, date: "2026-11-10", accountId: "itau", description: "Condomínio" },
          { id: "y", type: "expense", amountCents: 11_500, date: "2026-11-10", accountId: "itau", description: "Internet" },
        ],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("Amanhã vencem 2 contas (R$ 515,00)");
    expect(r[0].body).toBe("Condomínio R$ 400,00 (Itaú) · Internet R$ 115,00 (Itaú)");
  });

  it("receita prevista para hoje e lembrete 2 dias depois", () => {
    const pending = [{ id: "g", type: "income" as const, amountCents: 110_000, date: "2026-11-20", accountId: "inter", description: "Gestão" }];
    expect(buildAlerts(base({ today: "2026-11-20", pending }))[0].title).toBe("Hoje deve cair: Gestão");
    expect(buildAlerts(base({ today: "2026-11-21", pending }))).toEqual([]);
    const late = buildAlerts(base({ today: "2026-11-22", pending }))[0];
    expect(late.key).toBe("income-expected:g:2");
    expect(late.body).toContain("previsto para 20/11 na conta Inter");
  });

  it("fatura vencida em aberto: lembra de registrar o pagamento (dia seguinte e 3 dias depois)", () => {
    const statements = [{ id: "n1", cardId: "nu", cardName: "Nubank", paymentAccountId: "itau", dueDate: "2026-11-12", remainingCents: 13_840 }];
    const d1 = buildAlerts(base({ today: "2026-11-13", statements }));
    expect(d1).toHaveLength(1); // não vira "saldo não cobre"
    expect(d1[0].title).toBe("Fatura Nubank venceu ontem");
    expect(d1[0].body).toContain("registre o pagamento");
    expect(buildAlerts(base({ today: "2026-11-14", statements }))).toEqual([]);
    expect(buildAlerts(base({ today: "2026-11-15", statements }))[0].title).toBe("Fatura Nubank venceu em 12/11");
  });

  it("perigo vem antes de informação", () => {
    const r = buildAlerts(
      base({
        pending: [{ id: "x", type: "expense", amountCents: 1_000, date: "2026-11-10", accountId: "itau", description: "Taxa" }],
        statements: [{ id: "s1", cardId: "c1", cardName: "Santander Elite", paymentAccountId: "sant", dueDate: "2026-11-10", remainingCents: 159_455 }],
      }),
    );
    expect(r.map((a) => a.kind)).toEqual(["statement-due", "bills-due"]);
  });
});

describe("Edge Function usa as mesmas regras", () => {
  it("supabase/functions/alerts/alerts.ts é cópia exata de src/lib/finance/alerts.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const a = readFileSync("src/lib/finance/alerts.ts", "utf8");
    const b = readFileSync("supabase/functions/alerts/alerts.ts", "utf8");
    expect(b).toBe(a);
  });
});
