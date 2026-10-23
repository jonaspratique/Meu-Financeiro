import { describe, expect, it } from "vitest";
import {
  detectDelimiter, duplicateStatus, dupKey, extractRows, guessColumns, isOwnExport, looksLikeHeader, looseKey,
  parseAmount, parseCSV, parseDateAny, shouldInvertByDefault,
} from "@/lib/finance/csv-import";
import { suggestCategory } from "@/lib/finance/quick-parse";

describe("leitura de CSV", () => {
  it("detecta separador e respeita aspas", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("date,title,amount")).toBe(",");
    expect(parseCSV('﻿Data;Descrição;Valor\r\n01/10/2026;"Padaria; centro";-12,50\r\n02/10/2026;"Diz ""oi""";10\n')).toEqual([
      ["Data", "Descrição", "Valor"],
      ["01/10/2026", "Padaria; centro", "-12,50"],
      ["02/10/2026", 'Diz "oi"', "10"],
    ]);
  });

  it("datas e valores em formatos de bancos", () => {
    expect(parseDateAny("21/10/2026")).toBe("2026-10-21");
    expect(parseDateAny("1/2/26")).toBe("2026-02-01");
    expect(parseDateAny("2026-10-21 14:33:00")).toBe("2026-10-21");
    expect(parseDateAny("31/02/2026")).toBeNull();
    expect(parseAmount("-1.234,56")).toBe(-123456);
    expect(parseAmount("R$ 85,90")).toBe(8590);
    expect(parseAmount("(10,00)")).toBe(-1000);
    expect(parseAmount("10,00 D")).toBe(-1000);
    expect(parseAmount("10,00 C")).toBe(1000);
    expect(parseAmount("50,00-")).toBe(-5000);
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("−5,00")).toBe(-500);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("mapeamento e linhas", () => {
  it("extrato com cabeçalho BR", () => {
    const t = parseCSV("Data;Histórico;Valor\n05/10/2026;PIX ENVIADO MERCADO BOM;-152,30\n05/10/2026;SALDO DO DIA;1.000,00\n06/10/2026;SALARIO EMPRESA;4.500,00");
    expect(looksLikeHeader(t[0])).toBe(true);
    const map = guessColumns(t[0]);
    expect(map).toMatchObject({ date: 0, description: 1, amount: 2 });
    const rows = extractRows(t, map, { hasHeader: true, invert: false, target: "account" });
    expect(rows[0]).toMatchObject({ line: 2, date: "2026-10-05", amountCents: -15230, skip: null, error: null });
    expect(rows[1].skip).toBe("linha de saldo");
    expect(rows[2].amountCents).toBe(450000);
  });

  it("colunas separadas de crédito e débito e coluna D/C", () => {
    const t = parseCSV("Data;Descrição;Crédito;Débito\n01/10/2026;Tarifa;;12,90\n02/10/2026;Depósito;100,00;");
    const rows = extractRows(t, guessColumns(t[0]), { hasHeader: true, invert: false, target: "account" });
    expect(rows.map((r) => r.amountCents)).toEqual([-1290, 10000]);
    const t2 = parseCSV("Data;Descrição;Valor;Tipo\n01/10/2026;Luz;230,00;D");
    expect(extractRows(t2, guessColumns(t2[0]), { hasHeader: true, invert: false, target: "account" })[0].amountCents).toBe(-23000);
  });

  it("fatura de cartão (gastos positivos): inverte e ignora o pagamento", () => {
    const t = parseCSV("date,title,amount\n2026-10-01,Uber *Trip,23.90\n2026-10-02,iFood,45.00\n2026-10-05,Pagamento recebido,-900.00");
    const map = guessColumns(t[0]);
    const raw = extractRows(t, map, { hasHeader: true, invert: false, target: "card" });
    expect(shouldInvertByDefault(raw, "card")).toBe(true);
    const rows = extractRows(t, map, { hasHeader: true, invert: true, target: "card" });
    expect(rows[0].amountCents).toBe(-2390);
    expect(rows[2].skip).toBe("parece pagamento da fatura");
  });

  it("reconhece o CSV do próprio app e pula transferências", () => {
    const t = parseCSV("Data;Pago em;Tipo;Descrição;Categoria;Conta;Valor (R$);Situação\n01/10/2026;01/10/2026;Despesa;Mercado;Alimentação;Nubank;-100,00;Efetivado\n02/10/2026;;Transferência;Poupar;;A → B;500,00;Efetivado");
    expect(isOwnExport(t[0])).toBe(true);
    const map = guessColumns(t[0]);
    expect(map).toMatchObject({ date: 0, description: 3, amount: 6, type: 2, category: 4 });
    const rows = extractRows(t, map, { hasHeader: true, invert: false, target: "account" });
    expect(rows[0]).toMatchObject({ amountCents: -10000, categoryRaw: "Alimentação", skip: null });
    expect(rows[1].skip).toMatch(/transferência/);
  });

  it("linhas inválidas são apontadas", () => {
    const t = parseCSV("Data;Descrição;Valor\nxx;A;10\n01/10/2026;B;zz\n01/10/2026;;10");
    expect(extractRows(t, guessColumns(t[0]), { hasHeader: true, invert: false, target: "account" }).map((r) => r.error)).toEqual([
      "data inválida", "valor inválido", "sem descrição",
    ]);
  });
});

describe("duplicados e categorias", () => {
  it("mesma data + valor + descrição normalizada", () => {
    const existing = { strict: new Set([dupKey("2026-10-05", -15230, "Pix enviado Mercado Bom")]), loose: new Set([looseKey("2026-10-05", 15230), looseKey("2026-10-06", 999)]) };
    expect(duplicateStatus({ date: "2026-10-05", amountCents: -15230, description: "PIX ENVIADO MERCADO BOM" }, existing)).toBe("duplicate");
    expect(duplicateStatus({ date: "2026-10-06", amountCents: 999, description: "Outra coisa" }, existing)).toBe("possible");
    expect(duplicateStatus({ date: "2026-10-07", amountCents: 999, description: "Outra coisa" }, existing)).toBeNull();
  });

  it("sugere categoria por histórico, nome e dicionário", () => {
    const cats = [
      { id: "tr", name: "Transporte", kind: "expense" as const },
      { id: "al", name: "Alimentação", kind: "expense" as const },
      { id: "out", name: "Outras despesas", kind: "expense" as const },
      { id: "sal", name: "Salário", kind: "income" as const },
    ];
    expect(suggestCategory("POSTO SHELL 123", "expense", cats)).toBe("tr");
    expect(suggestCategory("UBER *TRIP", "expense", cats)).toBe("tr");
    expect(suggestCategory("Loja XPTO", "expense", cats)).toBe("out");
    expect(suggestCategory("PADARIA DO ZE 01", "expense", cats, [{ description: "Padaria do Zé", categoryId: "al", kind: "expense" }])).toBe("al");
    expect(suggestCategory("SALARIO EMPRESA X", "income", cats)).toBe("sal");
  });
});
