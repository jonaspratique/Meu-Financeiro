import { describe, expect, it } from "vitest";
import { quickParse, type ParseContext } from "@/lib/finance/quick-parse";

const cat = (id: string, name: string, kind: "income" | "expense") => ({ id, name, kind });
const ctx: ParseContext = {
  today: "2026-10-23", // sexta
  accounts: [
    { id: "itau", name: "Itaú", isDefault: true },
    { id: "poup", name: "Poupança" },
    { id: "din", name: "Carteira" },
  ],
  cards: [{ id: "nu", name: "Nubank" }],
  categories: [
    cat("sal", "Salário", "income"), cat("free", "Freelance", "income"), cat("rend", "Rendimentos", "income"),
    cat("outrasR", "Outras receitas", "income"),
    cat("transp", "Transporte", "expense"), cat("alim", "Alimentação", "expense"), cat("merc", "Mercado", "expense"),
    cat("saude", "Saúde", "expense"), cat("mor", "Moradia", "expense"), cat("casa", "Contas da casa", "expense"),
    cat("ass", "Assinaturas", "expense"), cat("lazer", "Lazer", "expense"), cat("comp", "Compras", "expense"),
    cat("outrasD", "Outras despesas", "expense"),
  ],
};

describe("lançamento por frase", () => {
  it("exemplo do prompt: gastei 85 reais de gasolina hoje", () => {
    expect(quickParse("Gastei 85 reais de gasolina hoje.", ctx)).toMatchObject({
      kind: "expense", amountCents: 8_500, categoryId: "transp", description: "Gasolina", date: "2026-10-23", status: "paid",
      installments: 1,
    });
  });

  it("compra parcelada no cartão citado pelo nome", () => {
    expect(quickParse("comprei notebook 3.600 em 6x no nubank", ctx)).toMatchObject({
      kind: "expense", amountCents: 360_000, installments: 6, destination: "card:nu", categoryId: "comp", description: "Notebook",
    });
  });

  it("'no cartão' com um único cartão usa esse cartão", () => {
    expect(quickParse("almoço 42,90 no cartão", ctx)).toMatchObject({
      destination: "card:nu", amountCents: 4_290, categoryId: "alim", description: "Almoço",
    });
  });

  it("receita de salário com dia do mês no passado", () => {
    expect(quickParse("recebi 4.500 de salário dia 5", ctx)).toMatchObject({
      kind: "income", amountCents: 450_000, categoryId: "sal", date: "2026-10-05", description: "Salário", status: "paid",
    });
    // dia maior que hoje no passado → mês anterior
    expect(quickParse("recebi 300 de freela dia 28", ctx)).toMatchObject({ date: "2026-09-28", categoryId: "free" });
  });

  it("conta a pagar com vencimento futuro", () => {
    expect(quickParse("conta de luz 230 vence dia 10", ctx)).toMatchObject({
      kind: "expense", amountCents: 23_000, categoryId: "casa", status: "pending", date: "2026-11-10",
    });
  });

  it("transferência entre contas pelas preposições", () => {
    expect(quickParse("transferi 500 do itaú para a poupança", ctx)).toMatchObject({
      kind: "transfer", amountCents: 50_000, fromAccountId: "itau", toAccountId: "poup", categoryId: null,
    });
    expect(quickParse("transferi 200 pra poupança do itau", ctx)).toMatchObject({ fromAccountId: "itau", toAccountId: "poup" });
  });

  it("datas: ontem, anteontem e dd/mm", () => {
    expect(quickParse("uber 23,50 ontem", ctx)).toMatchObject({ date: "2026-10-22", categoryId: "transp", amountCents: 2_350 });
    expect(quickParse("farmácia 60 anteontem", ctx)).toMatchObject({ date: "2026-10-21", categoryId: "saude" });
    expect(quickParse("mercado 312,40 em 15/10", ctx)).toMatchObject({ date: "2026-10-15", amountCents: 31_240, categoryId: "merc" });
  });

  it("valor por extenso com 'mil' e com R$", () => {
    expect(quickParse("aluguel 1,8 mil", ctx)).toMatchObject({ amountCents: 180_000, categoryId: "mor" });
    expect(quickParse("netflix R$ 55,90", ctx)).toMatchObject({ amountCents: 5_590, categoryId: "ass" });
  });

  it("palavra-chave mais específica vence ('mercado livre' é Compras, não Mercado)", () => {
    expect(quickParse("mercado livre 89,90", ctx)).toMatchObject({ categoryId: "comp" });
    expect(quickParse("supermercado 150", ctx)).toMatchObject({ categoryId: "merc" });
  });

  it("meio de pagamento e conta citada", () => {
    expect(quickParse("paguei 40 de pizza no pix pelo itaú", ctx)).toMatchObject({ paymentMethod: "pix", destination: "itau", categoryId: "alim" });
  });

  it("aprende com o histórico", () => {
    const withHistory = { ...ctx, history: [{ description: "Padaria do Zé", categoryId: "merc", kind: "expense" as const }] };
    expect(quickParse("padaria do zé 18", withHistory)).toMatchObject({ categoryId: "merc", description: "Padaria do zé" });
  });

  it("sem pistas: categoria 'Outras' e valor ausente não é inventado", () => {
    const r = quickParse("coisa aleatória", ctx);
    expect(r.categoryId).toBe("outrasD");
    expect(r.amountCents).toBeNull();
    expect(r.description).toBe("Coisa aleatória");
  });
});
