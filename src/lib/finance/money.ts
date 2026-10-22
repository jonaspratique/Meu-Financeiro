/**
 * Dinheiro é SEMPRE inteiro em centavos. Nunca usar float para somar valores.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 123456 -> "R$ 1.234,56" (com espaço normal, não o NBSP do Intl). */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100).replace(/ /g, " ");
}

export function formatBRLCompact(cents: number): string {
  return brlCompact.format(cents / 100).replace(/ /g, " ");
}

/** Formata para exibição em um input: 123456 -> "1.234,56" */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100).toLocaleString("pt-BR");
  const cent = String(abs % 100).padStart(2, "0");
  return `${sign}${reais},${cent}`;
}

/**
 * Converte texto digitado em centavos, de forma tolerante:
 *   "1.234,56" | "1234,56" | "1234.56" | "R$ 85" | "85,5" | "-10,00"
 * Retorna null se não for um valor válido.
 */
export function parseBRL(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s|R\$/gi, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let decPart = "";

  if (lastComma >= 0 && lastComma > lastDot) {
    // vírgula é o separador decimal (padrão BR)
    intPart = s.slice(0, lastComma).replace(/\./g, "");
    decPart = s.slice(lastComma + 1);
  } else if (lastDot >= 0) {
    const after = s.slice(lastDot + 1);
    const dots = (s.match(/\./g) ?? []).length;
    if (lastComma < 0 && dots === 1 && after.length !== 3) {
      // "1234.5" ou "85.90" -> ponto decimal
      intPart = s.slice(0, lastDot);
      decPart = after;
    } else {
      // "1.234" ou "1.234.567" -> pontos de milhar; "1,234.56" -> padrão US
      if (lastComma >= 0) {
        intPart = s.slice(0, lastDot).replace(/,/g, "");
        decPart = after;
      } else {
        intPart = s.replace(/\./g, "");
      }
    }
  } else {
    intPart = s;
  }

  if (intPart.includes(",") || decPart.includes(",") || decPart.includes(".")) return null;
  if (decPart.length > 2) return null;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null;
  if (!intPart && !decPart) return null;

  const cents = Number(intPart || "0") * 100 + Number((decPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Soma segura (inteiros). */
export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
