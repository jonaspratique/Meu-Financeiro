/**
 * Importação de CSV (extratos de banco, faturas de cartão e o próprio CSV do app).
 * Tudo aqui é puro e testável; nada é gravado sem o usuário conferir a prévia.
 */
import { isISODate, type ISODate } from "./dates";
import { parseBRL } from "./money";
import { norm } from "./quick-parse";

export const IMPORT_LIMIT = 1000;

/* --------------------------------- leitura --------------------------------- */
/** Detecta o separador pela primeira linha (fora de aspas): ; , ou tab. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let q = false;
  for (const ch of first) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  // em empate, ";" (padrão BR, onde a vírgula é decimal)
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === ";" ? -1 : b[0] === ";" ? 1 : 0))[0];
  return n > 0 ? best : ";";
}

/** CSV com aspas, aspas duplicadas, quebras de linha dentro de aspas e BOM. */
export function parseCSV(text: string, delimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      q = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/* --------------------------------- valores --------------------------------- */
/** Datas: 21/10/2026, 21/10/26, 21-10-2026, 21.10.2026, 2026-10-21 (com ou sem hora). */
export function parseDateAny(input: string): ISODate | null {
  const s = input.trim().split(/[ T]/)[0];
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, +m[2], +m[1]);
  }
  return null;
}
function valid(y: number, mo: number, d: number): ISODate | null {
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}

/**
 * Valores: "-1.234,56", "R$ 85,90", "(10,00)", "10,00-", "10,00 D", "1,234.56", "−5,00".
 * Retorna centavos com sinal (D/parênteses/menos = negativo).
 */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/−/g, "-").replace(/\s+/g, " ");
  if (!s) return null;
  let neg = false;
  const dc = /\s*([DC])$/i.exec(s);
  if (dc) {
    neg = dc[1].toUpperCase() === "D";
    s = s.slice(0, dc.index);
  }
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/R\$/gi, "").replace(/\s/g, "");
  if (s.endsWith("-")) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  const v = parseBRL(s);
  if (v == null) return null;
  return neg ? -Math.abs(v) : v;
}

/* ------------------------------ mapeamento ------------------------------ */
export interface ColumnMap {
  date: number;
  description: number;
  /** valor com sinal; ou use credit/debit */
  amount: number | null;
  credit: number | null;
  debit: number | null;
  /** coluna "tipo" (D/C, Débito/Crédito, Receita/Despesa…) */
  type: number | null;
  category: number | null;
}

const H = (s: string) => norm(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const pick = (header: string[], tests: RegExp[], skip: number[] = []) => {
  for (const t of tests) {
    const i = header.findIndex((h, idx) => !skip.includes(idx) && t.test(H(h)));
    if (i >= 0) return i;
  }
  return null;
};

/** Tenta reconhecer as colunas pelo cabeçalho. */
export function guessColumns(header: string[]): ColumnMap {
  const date = pick(header, [/^data( (do )?(lancamento|movimento|compra|transacao))?$/, /^date$/, /^data\b/, /\bdata\b/, /\bdate\b/]);
  const credit = pick(header, [/^(credito|entrada|entradas|creditos)( r)?$/]);
  const debit = pick(header, [/^(debito|saida|saidas|debitos)( r)?$/]);
  const amount = pick(header, [/^valor( r)?$/, /^amount$/, /^valor\b/, /\bvalor\b/, /\bamount\b/, /^quantia$/]);
  const skip = [date, amount, credit, debit].filter((x): x is number => x != null);
  const description = pick(
    header,
    [/^(descricao|historico|title|description|lancamento|estabelecimento|memo)$/, /descri/, /histor/, /\btitle\b/, /lancamento/, /estabelecimento/],
    skip,
  );
  const type = pick(header, [/^(tipo|type|d c|natureza)$/], [...skip, ...(description != null ? [description] : [])]);
  const category = pick(header, [/^(categoria|category)$/], [...skip, ...(description != null ? [description] : [])]);
  return {
    date: date ?? 0,
    description: description ?? (header.length > 1 ? 1 : 0),
    amount: amount ?? (credit == null && debit == null ? Math.max(0, header.length - 1) : null),
    credit,
    debit,
    type,
    category,
  };
}

/** A primeira linha parece cabeçalho (não tem data nem valor reconhecível)? */
export function looksLikeHeader(row: string[]) {
  return !row.some((c) => parseDateAny(c)) && !row.some((c) => /\d/.test(c) && parseAmount(c) != null);
}

/** CSV exportado pelo próprio Meu Financeiro. */
export function isOwnExport(header: string[]) {
  const h = header.map(H);
  return h[0] === "data" && h.includes("pago em") && h.includes("tipo") && h.some((x) => x.startsWith("valor"));
}

/* -------------------------------- linhas -------------------------------- */
export interface ImportRow {
  line: number;
  date: ISODate | null;
  description: string;
  /** + entrada, − saída (já com a convenção de sinal aplicada) */
  amountCents: number | null;
  categoryRaw: string;
  typeRaw: string;
  /** motivo para vir desmarcada por padrão */
  skip: string | null;
  error: string | null;
}

const DEBIT_WORDS = /^(d|deb|debito|saida|despesa|pagamento|compra)\b/;
const CREDIT_WORDS = /^(c|cred|credito|entrada|receita|deposito)\b/;

export function extractRows(
  table: string[][],
  map: ColumnMap,
  opts: { hasHeader: boolean; invert: boolean; target: "account" | "card" },
): ImportRow[] {
  const body = opts.hasHeader ? table.slice(1) : table;
  const own = opts.hasHeader && isOwnExport(table[0] ?? []);
  return body.map((r, i) => {
    const line = i + (opts.hasHeader ? 2 : 1);
    const get = (idx: number | null) => (idx == null ? "" : (r[idx] ?? "").trim());
    const date = parseDateAny(get(map.date));
    const description = get(map.description).replace(/\s+/g, " ").slice(0, 120);
    const typeRaw = get(map.type);
    let amount: number | null = null;
    if (map.amount != null) {
      amount = parseAmount(get(map.amount));
    } else {
      const c = map.credit != null && get(map.credit) ? parseAmount(get(map.credit)) : 0;
      const d = map.debit != null && get(map.debit) ? parseAmount(get(map.debit)) : 0;
      amount = c == null || d == null ? null : Math.abs(c) - Math.abs(d);
    }
    // coluna tipo sem sinal no valor: D/Débito → saída, C/Crédito → entrada
    if (amount != null && typeRaw && !own) {
      const t = H(typeRaw);
      if (DEBIT_WORDS.test(t)) amount = -Math.abs(amount);
      else if (CREDIT_WORDS.test(t)) amount = Math.abs(amount);
    }
    if (amount != null && opts.invert) amount = -amount;

    let skip: string | null = null;
    const nd = H(`${description} ${typeRaw}`);
    if (own && /^(transferencia|pagamento de fatura)/.test(H(typeRaw))) skip = "transferência/fatura (não importada)";
    else if (opts.target === "card" && /\b(pagamento (recebido|de fatura|fatura)|pgto fatura|pagamento efetuado)\b/.test(nd))
      skip = "parece pagamento da fatura";
    else if (/\bsaldo (anterior|do dia|final|inicial)\b|^saldo\b/.test(H(description))) skip = "linha de saldo";

    let error: string | null = null;
    if (!date) error = "data inválida";
    else if (amount == null) error = "valor inválido";
    else if (amount === 0) error = "valor zero";
    else if (!description) error = "sem descrição";

    return { line, date, description, amountCents: amount, categoryRaw: get(map.category), typeRaw, skip, error };
  });
}

/* ------------------------------ duplicados ------------------------------ */
export const normDesc = (s: string) => H(s).replace(/\b\d{2,}\b/g, "").replace(/\s+/g, " ").trim();
export const dupKey = (date: ISODate, amountCents: number, description: string) =>
  `${date}|${Math.abs(amountCents)}|${normDesc(description)}`;
export const looseKey = (date: ISODate, amountCents: number) => `${date}|${Math.abs(amountCents)}`;

export type DupStatus = "duplicate" | "possible" | null;
export function duplicateStatus(
  row: { date: ISODate; amountCents: number; description: string },
  existing: { strict: Set<string>; loose: Set<string> },
): DupStatus {
  if (existing.strict.has(dupKey(row.date, row.amountCents, row.description))) return "duplicate";
  if (existing.loose.has(looseKey(row.date, row.amountCents))) return "possible";
  return null;
}

/** Convenção de sinal: em fatura de cartão os gastos costumam vir positivos. */
export function shouldInvertByDefault(rows: ImportRow[], target: "account" | "card") {
  if (target !== "card") return false;
  const vals = rows.filter((r) => !r.error && r.amountCents).map((r) => r.amountCents!);
  return vals.filter((v) => v > 0).length > vals.filter((v) => v < 0).length;
}
