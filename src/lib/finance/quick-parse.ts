/**
 * Lançamento por frase — interpretação LOCAL por regras (sem IA externa).
 *
 *   "gastei 85 reais de gasolina hoje"           → despesa R$ 85 · Transporte · Gasolina · hoje
 *   "comprei notebook 3.600 em 6x no nubank"     → despesa no cartão Nubank em 6x · Compras
 *   "recebi 4.500 de salário dia 5"              → receita · Salário
 *   "transferi 500 do itaú para a poupança"      → transferência Itaú → Poupança
 *   "conta de luz 230 vence dia 10"              → despesa a pagar · Contas da casa
 *
 * O resultado SEMPRE vai para o formulário, onde o usuário confere e confirma.
 */
import { addDays, daysInMonth, type ISODate } from "./dates";
import { parseBRL } from "./money";

export interface ParseContext {
  today: ISODate;
  accounts: { id: string; name: string; isDefault?: boolean; archived?: boolean }[];
  cards: { id: string; name: string; archived?: boolean }[];
  categories: { id: string; name: string; kind: "income" | "expense"; archived?: boolean }[];
  /** Histórico (descrição → categoria) para aprender com lançamentos anteriores. */
  history?: { description: string; categoryId: string; kind: "income" | "expense" }[];
}

export type QuickKind = "expense" | "income" | "transfer";
export type PaymentHint = "pix" | "debit" | "cash" | "boleto" | "bank_transfer" | "auto_debit";

export interface QuickParse {
  kind: QuickKind;
  amountCents: number | null;
  description: string;
  date: ISODate;
  status: "paid" | "pending";
  categoryId: string | null;
  /** id da conta ou "card:<id>" */
  destination: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  installments: number;
  paymentMethod: PaymentHint | null;
  /** O que foi deduzido (para mostrar ao usuário). */
  understood: string[];
}

export const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/* ------------------------- dicionário de categorias ------------------------- */
const EXPENSE_KEYWORDS: Record<string, string[]> = {
  Transporte: [
    "gasolina", "combustivel", "etanol", "alcool no posto", "diesel", "posto", "uber", "99pop", "taxi", "onibus",
    "metro", "trem", "estacionamento", "pedagio", "ipva", "oficina", "mecanico", "troca de oleo", "lavagem do carro",
    "passagem de onibus", "bilhete unico",
  ],
  Alimentação: [
    "almoco", "janta", "jantar", "cafe da manha", "cafe", "lanche", "restaurante", "ifood", "padaria", "pizza",
    "hamburguer", "delivery", "acai", "marmita", "sorvete", "rappi",
  ],
  Mercado: ["supermercado", "mercado", "feira", "hortifruti", "atacadao", "assai", "carrefour", "pao de acucar", "sacolao"],
  Saúde: ["farmacia", "remedio", "medicamento", "medico", "consulta", "exame", "dentista", "plano de saude", "psicologo", "terapia", "academia", "suplemento"],
  Moradia: ["aluguel", "condominio", "iptu", "reforma", "moveis", "diarista"],
  "Contas da casa": ["conta de luz", "luz", "energia", "conta de agua", "agua", "gas", "internet", "telefone", "conta do celular", "tv a cabo"],
  Assinaturas: [
    "netflix", "spotify", "amazon prime", "prime video", "disney", "hbo", "max", "youtube premium", "icloud",
    "google one", "assinatura", "chatgpt", "deezer", "globoplay", "apple music",
  ],
  Lazer: ["cinema", "show", "bar", "balada", "viagem", "passeio", "ingresso", "teatro", "jogo", "hotel", "airbnb", "cerveja"],
  Educação: ["curso", "faculdade", "escola", "livro", "mensalidade escolar", "material escolar", "udemy", "idiomas"],
  Compras: [
    "mercado livre", "shopee", "amazon", "magalu", "shein", "roupa", "roupas", "tenis", "sapato", "presente", "shopping",
    "eletronico", "notebook", "celular novo", "fone",
  ],
  "Cuidados pessoais": ["cabelo", "cabeleireiro", "barbeiro", "barbearia", "manicure", "salao", "perfume", "cosmetico", "maquiagem"],
  "Impostos e taxas": ["imposto", "taxa", "tarifa", "anuidade", "iof", "multa", "juros", "das", "irpf"],
};

const INCOME_KEYWORDS: Record<string, string[]> = {
  Salário: ["salario", "pagamento da empresa", "adiantamento", "vale", "13o", "decimo terceiro", "ferias", "plr"],
  Freelance: ["freela", "freelance", "job", "projeto", "consultoria", "servico prestado"],
  Rendimentos: ["rendimento", "rendimentos", "dividendo", "dividendos", "cdb", "tesouro", "juros"],
  Reembolsos: ["reembolso", "estorno", "devolucao"],
};

const STOPWORDS = new Set([
  "gastei", "gasto", "paguei", "pago", "pagar", "comprei", "compra", "recebi", "receber", "ganhei", "entrou", "caiu",
  "transferi", "transferencia", "vou", "vai", "vence", "venceu", "vencimento", "de", "do", "da", "dos", "das", "no",
  "na", "nos", "nas", "em", "com", "um", "uma", "o", "a", "os", "as", "e", "pra", "para", "pro", "por", "reais", "real",
  "conto", "contos", "pila", "r$", "hoje", "ontem", "anteontem", "amanha", "dia", "cartao", "credito", "debito",
  "pix", "dinheiro", "boleto", "ted", "doc", "parcelado", "parcelada", "parcelas", "vezes", "x", "a vista", "avista",
  "valor", "foi", "meu", "minha", "conta", "pelo", "pela", "via", "usando", "|",
]);

/* ---------------------------------- datas ---------------------------------- */
const pad = (n: number) => String(n).padStart(2, "0");
function mkDate(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "dia 5": no passado (gastei) → última vez que foi dia 5; no futuro (vence) → próxima. */
function dayOfMonth(day: number, today: ISODate, future: boolean): ISODate | null {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const t = Number(today.slice(8, 10));
  if (future ? day < t : day > t) {
    m += future ? 1 : -1;
    if (m === 0) { m = 12; y--; }
    if (m === 13) { m = 1; y++; }
  }
  return mkDate(y, m, Math.min(day, daysInMonth(y, m)));
}

/* ---------------------------------- parser ---------------------------------- */
export function quickParse(text: string, ctx: ParseContext): QuickParse {
  const original = text.trim();
  // pontuação solta vira espaço (mas mantém "85,90" e "1.200")
  let s = ` ${norm(original).replace(/(?<!\d)[.,;:!?]|[.,;:!?](?!\d)/g, " ")} `.replace(/\s+/g, " ");
  const CUT = " | "; // marca trechos já interpretados (separa a descrição em segmentos)
  const understood: string[] = [];

  // ----- tipo -----
  let kind: QuickKind = "expense";
  if (/\b(transferi|transferencia|transfere|transferir)\b/.test(s)) kind = "transfer";
  else if (/\b(recebi|receber|ganhei|entrou|caiu|recebimento|deposito recebido)\b/.test(s)) kind = "income";
  else if (!/\b(gastei|paguei|comprei|pagar|gasto|compra|conta)\b/.test(s)) {
    // sem verbo: decide pela palavra-chave
    const inc = Object.values(INCOME_KEYWORDS).flat().some((k) => s.includes(` ${k} `));
    if (inc) kind = "income";
  }

  // ----- pendente (a pagar / a receber) -----
  const future = /\b(vou pagar|vou receber|a pagar|a receber|vence|vencimento|agendad[oa]|amanha|vai cair)\b/.test(s);
  const status: "paid" | "pending" = future ? "pending" : "paid";

  // ----- parcelas -----
  let installments = 1;
  const inst =
    /\b(?:em\s+)?(\d{1,2})\s*x\b/.exec(s) ?? /\bem\s+(\d{1,2})\s+(?:vezes|parcelas)\b/.exec(s) ?? /\bparcelad[oa]\s+em\s+(\d{1,2})\b/.exec(s);
  if (inst) {
    installments = Math.max(1, Math.min(72, Number(inst[1])));
    s = s.replace(inst[0], CUT);
  }

  // ----- data -----
  let date = ctx.today;
  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(ctx.today.slice(0, 4));
    const d = mkDate(y, Number(dm[2]), Number(dm[1]));
    if (d) {
      date = d;
      s = s.replace(dm[0], CUT);
    }
  } else if (/\banteontem\b/.test(s)) {
    date = addDays(ctx.today, -2);
  } else if (/\bontem\b/.test(s)) {
    date = addDays(ctx.today, -1);
  } else if (/\bamanha\b/.test(s)) {
    date = addDays(ctx.today, 1);
  } else {
    const dd = /\bdia\s+(\d{1,2})\b/.exec(s);
    if (dd) {
      const d = dayOfMonth(Number(dd[1]), ctx.today, future);
      if (d) {
        date = d;
        s = s.replace(dd[0], CUT);
      }
    }
  }

  // ----- valor -----
  let amountCents: number | null = null;
  const candidates: { cents: number; strong: boolean; raw: string }[] = [];
  const amountRe = /(r\$\s*)?(\d[\d.,]*)(\s*mil\b)?(\s*(?:reais|real|conto|contos|pila)\b)?/g;
  for (const m of s.matchAll(amountRe)) {
    let cents = parseBRL(m[2].replace(/[.,]$/, ""));
    if (cents == null) continue;
    if (m[3]) cents *= 1000;
    candidates.push({ cents, strong: Boolean(m[1] || m[3] || m[4]), raw: m[0] });
  }
  const pick = candidates.find((c) => c.strong) ?? candidates[0];
  if (pick && pick.cents > 0) {
    amountCents = pick.cents;
    s = s.replace(pick.raw, CUT);
  }

  // ----- meio de pagamento -----
  let paymentMethod: PaymentHint | null = null;
  if (/\bpix\b/.test(s)) paymentMethod = "pix";
  else if (/\bdebito automatico\b/.test(s)) paymentMethod = "auto_debit";
  else if (/\bdebito\b/.test(s)) paymentMethod = "debit";
  else if (/\bem dinheiro\b|\bdinheiro vivo\b/.test(s)) paymentMethod = "cash";
  else if (/\bboleto\b/.test(s)) paymentMethod = "boleto";
  else if (/\b(ted|doc)\b/.test(s)) paymentMethod = "bank_transfer";

  // ----- contas e cartões mencionados -----
  type Hit = { id: string; name: string; isCard: boolean; index: number; len: number };
  const hits: Hit[] = [];
  const findName = (name: string) => {
    const n = norm(name);
    if (n.length < 2) return -1;
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    const m = re.exec(s);
    return m ? m.index + m[1].length : -1;
  };
  for (const c of ctx.cards.filter((x) => !x.archived)) {
    const i = findName(c.name);
    if (i >= 0) hits.push({ id: c.id, name: c.name, isCard: true, index: i, len: norm(c.name).length });
  }
  for (const a of ctx.accounts.filter((x) => !x.archived)) {
    const i = findName(a.name);
    if (i >= 0) hits.push({ id: a.id, name: a.name, isCard: false, index: i, len: norm(a.name).length });
  }
  const mentionsCard = /\b(cartao|credito|no credito|fatura)\b/.test(s) || installments > 1;

  let destination: string | null = null;
  let fromAccountId: string | null = null;
  let toAccountId: string | null = null;

  if (kind === "transfer") {
    const accs = hits.filter((h) => !h.isCard).sort((a, b) => a.index - b.index);
    for (const h of accs) {
      const before = s.slice(Math.max(0, h.index - 8), h.index);
      if (/\b(para|pra|pro|p\/)\s*(a|o)?\s*$/.test(before)) toAccountId ??= h.id;
      else if (/\b(do|da|de)\s*$/.test(before)) fromAccountId ??= h.id;
    }
    // sem preposição clara: 1ª citada = origem, 2ª = destino
    const rest = accs.map((h) => h.id).filter((id) => id !== fromAccountId && id !== toAccountId);
    fromAccountId ??= rest.shift() ?? null;
    toAccountId ??= rest.shift() ?? null;
    if (fromAccountId) understood.push(`de ${ctx.accounts.find((a) => a.id === fromAccountId)?.name}`);
    if (toAccountId) understood.push(`para ${ctx.accounts.find((a) => a.id === toAccountId)?.name}`);
  } else {
    const best = [...hits]
      .filter((h) => kind === "expense" || !h.isCard)
      .sort((a, b) => (a.isCard === b.isCard ? b.len - a.len : mentionsCard === a.isCard ? -1 : 1))[0];
    if (best) {
      destination = best.isCard ? `card:${best.id}` : best.id;
      understood.push(best.isCard ? `cartão ${best.name}` : `conta ${best.name}`);
    } else if (kind === "expense" && mentionsCard) {
      const active = ctx.cards.filter((c) => !c.archived);
      if (active.length === 1) {
        destination = `card:${active[0].id}`;
        understood.push(`cartão ${active[0].name}`);
      }
    }
  }
  for (const h of hits) s = s.replace(new RegExp(`(^|\\s)${norm(h.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`), CUT);

  // ----- categoria -----
  const kindCats = ctx.categories.filter((c) => !c.archived && c.kind === (kind === "income" ? "income" : "expense"));
  const byName = (name: string) => kindCats.find((c) => norm(c.name) === norm(name));
  let categoryId: string | null = null;
  let keyword: string | null = null;

  // 1) nome de categoria citado ("lazer", "mercado")
  for (const c of [...kindCats].sort((a, b) => b.name.length - a.name.length)) {
    if (s.includes(` ${norm(c.name)} `)) {
      categoryId = c.id;
      keyword = norm(c.name);
      break;
    }
  }
  // 2) palavra-chave do dicionário (mais longa primeiro: "mercado livre" antes de "mercado")
  const dict = kind === "income" ? INCOME_KEYWORDS : EXPENSE_KEYWORDS;
  const pairs = Object.entries(dict)
    .flatMap(([cat, words]) => words.map((w) => ({ cat, w })))
    .sort((a, b) => b.w.length - a.w.length);
  const dictHit = pairs.find(({ w }) => s.includes(` ${w} `));
  if (dictHit) {
    keyword = dictHit.w;
    const dictCat = byName(dictHit.cat);
    // palavra-chave mais específica vence nome genérico ("mercado livre" → Compras)
    if (dictCat && (!categoryId || dictHit.w.length > (norm(kindCats.find((c) => c.id === categoryId)!.name).length))) {
      categoryId = dictCat.id;
    }
  }

  // ----- descrição -----
  // segmentos entre os trechos interpretados; tira palavras de ligação só das pontas
  const segments = s.split("|").map((seg) => {
    const ws = seg.trim().split(/\s+/).filter(Boolean).filter((w) => !/^\d+([.,]\d+)?$/.test(w));
    while (ws.length && STOPWORDS.has(ws[0])) ws.shift();
    while (ws.length && STOPWORDS.has(ws[ws.length - 1])) ws.pop();
    return ws.join(" ");
  });
  let description = segments.reduce((a, b) => (b.length > a.length ? b : a), "");
  if (keyword && (!description || description.length > keyword.length + 25)) description = keyword;
  // recupera acentos e maiúsculas da frase original quando possível
  description = restoreOriginal(description, original);
  if (!description && categoryId) description = kindCats.find((c) => c.id === categoryId)!.name;
  if (!description && kind === "transfer") description = "Transferência";

  // 3) histórico: mesma descrição usada antes → mesma categoria
  if (ctx.history?.length && description) {
    const nd = norm(description);
    const h = ctx.history.find((x) => x.kind === (kind === "income" ? "income" : "expense") && norm(x.description) === nd);
    if (h && kindCats.some((c) => c.id === h.categoryId)) {
      categoryId = h.categoryId;
      understood.push("categoria do seu histórico");
    }
  }
  if (!categoryId && kind !== "transfer") {
    categoryId = byName(kind === "income" ? "Outras receitas" : "Outras despesas")?.id ?? kindCats[0]?.id ?? null;
  }

  if (installments > 1) understood.push(`${installments}x`);
  if (status === "pending") understood.push(kind === "income" ? "a receber" : "a pagar");

  return {
    kind,
    amountCents,
    description: capitalize(description).slice(0, 120),
    date,
    status,
    categoryId: kind === "transfer" ? null : categoryId,
    destination,
    fromAccountId,
    toAccountId,
    installments,
    paymentMethod,
    understood,
  };
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Procura o trecho equivalente na frase original para manter acentos ("gasolina" → "gasolina", "almoco" → "almoço"). */
function restoreOriginal(normalized: string, original: string) {
  if (!normalized) return "";
  const tokens = original.split(/\s+/);
  const normTokens = tokens.map(norm);
  const target = normalized.split(" ");
  for (let i = 0; i + target.length <= normTokens.length; i++) {
    if (target.every((t, j) => normTokens[i + j].replace(/[^a-z0-9]/g, "") === t.replace(/[^a-z0-9]/g, ""))) {
      return tokens.slice(i, i + target.length).join(" ").replace(/[.,;:!?]+$/, "");
    }
  }
  return normalized;
}

/**
 * Sugere a categoria de uma descrição solta (ex.: linha de extrato bancário):
 * histórico igual → nome de categoria citado → dicionário → "Outras …".
 */
export function suggestCategory(
  description: string,
  kind: "income" | "expense",
  categories: ParseContext["categories"],
  history: ParseContext["history"] = [],
): string | null {
  const kindCats = categories.filter((c) => !c.archived && c.kind === kind);
  const byName = (name: string) => kindCats.find((c) => norm(c.name) === norm(name));
  const s = ` ${norm(description).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const nd = s.trim();
  const valid = (id: string) => kindCats.some((c) => c.id === id);

  const exact = history.find((h) => h.kind === kind && norm(h.description) === nd && valid(h.categoryId));
  if (exact) return exact.categoryId;
  // descrição do histórico contida na linha ("SUPERMERCADO PAO DE ACUCAR 123" ⊃ "pao de acucar")
  const contained = history
    .filter((h) => h.kind === kind && valid(h.categoryId) && norm(h.description).length >= 4)
    .find((h) => s.includes(` ${norm(h.description).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `));
  if (contained) return contained.categoryId;

  const named = [...kindCats].sort((a, b) => b.name.length - a.name.length).find((c) => s.includes(` ${norm(c.name)} `));
  const dict = kind === "income" ? INCOME_KEYWORDS : EXPENSE_KEYWORDS;
  const hit = Object.entries(dict)
    .flatMap(([cat, words]) => words.map((w) => ({ cat, w })))
    .sort((a, b) => b.w.length - a.w.length)
    .find(({ cat, w }) => s.includes(` ${w} `) && byName(cat));
  // palavra-chave mais específica vence nome genérico ("mercado livre" → Compras)
  if (hit && (!named || hit.w.length > norm(named.name).length)) return byName(hit.cat)!.id;
  if (named) return named.id;
  return byName(kind === "income" ? "Outras receitas" : "Outras despesas")?.id ?? kindCats[0]?.id ?? null;
}
