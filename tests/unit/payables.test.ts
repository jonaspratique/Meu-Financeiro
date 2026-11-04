import { describe, expect, it } from "vitest";
import { monthPayables } from "@/lib/finance/payables";
import { monthRange } from "@/lib/finance/dates";

describe("a pagar no mês (contas + faturas)", () => {
  const range = monthRange("2026-11");
  it("soma contas do mês e faturas que vencem no mês, separando pago e em aberto", () => {
    const r = monthPayables(
      range,
      "2026-11-10",
      [
        { amountCents: 40_000, date: "2026-11-12", status: "pending" },
        { amountCents: 11_500, date: "2026-11-05", status: "paid" },
        { amountCents: 99_999, date: "2026-11-20", status: "cancelled" },
        { amountCents: 5_000, date: "2026-10-30", status: "pending" }, // outro mês
      ],
      [
        { cardId: "itau", cardName: "Itaú", dueDate: "2026-11-09", closingDate: "2026-11-02", chargesCents: 3_115_767, creditsCents: 27, paymentsCents: 3_115_740 },
        { cardId: "nu", cardName: "Nubank", dueDate: "2026-11-12", closingDate: "2026-11-05", chargesCents: 33_320, creditsCents: 0, paymentsCents: 19_480 },
        { cardId: "itau", cardName: "Itaú", dueDate: "2026-12-09", closingDate: "2026-12-02", chargesCents: 182_133, creditsCents: 0, paymentsCents: 0 },
      ],
    );
    expect(r.bills).toEqual({ total: 51_500, paid: 11_500, remaining: 40_000, count: 2 });
    expect(r.cards.map((c) => [c.cardName, c.total, c.paid, c.remaining])).toEqual([
      ["Itaú", 3_115_740, 3_115_740, 0],
      ["Nubank", 33_320, 19_480, 13_840],
    ]);
    expect(r.total).toBe(51_500 + 3_115_740 + 33_320);
    expect(r.remaining).toBe(40_000 + 13_840);
  });

  it("fatura que ainda não fechou aparece como aberta (valor pode subir)", () => {
    const r = monthPayables(range, "2026-11-03", [], [
      { cardId: "inter", cardName: "Inter", dueDate: "2026-11-12", closingDate: "2026-11-06", chargesCents: 617_235, creditsCents: 0, paymentsCents: 0 },
    ]);
    expect(r.cards[0].open).toBe(true);
  });
});
