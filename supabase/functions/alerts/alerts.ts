/**
 * Avisos do dia (notificações no celular e card "Avisos" no início).
 *
 * Módulo SEM imports de propósito: o mesmo arquivo roda no app (Next.js) e na
 * Edge Function do Supabase (Deno) que envia as notificações às 9h.
 *
 * Avisos:
 *  - statement-due   fatura vence amanhã (com aviso se o saldo da conta não cobre)
 *  - shortfall       nos próximos dias, o saldo da conta não cobre o que vai sair dela
 *  - bills-due       contas a pagar que vencem amanhã
 *  - statement-overdue fatura venceu (ontem ou há 3 dias) e não está registrada como paga
 *  - income-expected receita prevista para hoje (ou atrasada há 2 dias) ainda não marcada
 */

export type AlertKind = "statement-due" | "shortfall" | "bills-due" | "statement-overdue" | "income-expected";

export interface AlertItem {
  /** chave estável: evita mandar o mesmo aviso duas vezes no mesmo dia */
  key: string;
  kind: AlertKind;
  severity: "danger" | "warning" | "info";
  title: string;
  body: string;
  url: string;
}

export interface AlertInput {
  today: string; // AAAA-MM-DD (fuso de São Paulo)
  /** quantos dias à frente checar se o saldo cobre (padrão 3) */
  horizonDays?: number;
  accounts: { id: string; name: string; archived?: boolean }[];
  /** saldo e reservado por conta, na data de hoje */
  balances: { accountId: string; balanceCents: number; reservedCents: number }[];
  /** lançamentos pendentes (contas a pagar/receber) */
  pending: { id: string; type: "income" | "expense"; amountCents: number; date: string; accountId: string; description: string }[];
  /** faturas com valor em aberto */
  statements: { id: string; cardId: string; cardName: string; paymentAccountId: string | null; dueDate: string; remainingCents: number }[];
}

/* ------------------------------- utilitários ------------------------------- */
const DAY = 86_400_000;
const toUTC = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const addDaysISO = (d: string, n: number) => new Date(toUTC(d) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / DAY);
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export function brl(cents: number) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${int},${String(abs % 100).padStart(2, "0")}`;
}
function joinPt(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}
const dayWord = (today: string, d: string) => {
  const n = daysBetween(today, d);
  return n <= 0 ? "hoje" : n === 1 ? "amanhã" : `em ${ddmm(d)}`;
};

/* --------------------------------- regras --------------------------------- */
interface Outflow {
  date: string;
  amountCents: number;
  label: string;
}

export function buildAlerts(input: AlertInput): AlertItem[] {
  const { today } = input;
  const horizon = input.horizonDays ?? 3;
  const tomorrow = addDaysISO(today, 1);
  const until = addDaysISO(today, horizon);
  const accounts = input.accounts.filter((a) => !a.archived);
  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "conta não definida";
  const available = new Map(input.balances.map((b) => [b.accountId, b.balanceCents - b.reservedCents]));

  /* ---- fluxo por conta na janela [hoje, hoje+horizonte] ---- */
  type Flow = { outflows: Outflow[]; inflows: Outflow[] };
  const flows = new Map<string, Flow>();
  const flowOf = (id: string) => {
    if (!flows.has(id)) flows.set(id, { outflows: [], inflows: [] });
    return flows.get(id)!;
  };
  for (const p of input.pending) {
    if (p.date > until) continue;
    if (p.type === "expense") {
      // despesa atrasada continua pesando no saldo de hoje
      flowOf(p.accountId).outflows.push({ date: p.date < today ? today : p.date, amountCents: p.amountCents, label: p.description });
    } else if (p.date >= today) {
      // receita só conta a partir do dia previsto (atrasada é incerta)
      flowOf(p.accountId).inflows.push({ date: p.date, amountCents: p.amountCents, label: p.description });
    }
  }
  for (const s of input.statements) {
    // fatura vencida em aberto quase sempre é pagamento não registrado: tem aviso próprio
    if (!s.paymentAccountId || s.remainingCents <= 0 || s.dueDate > until || s.dueDate < today) continue;
    flowOf(s.paymentAccountId).outflows.push({
      date: s.dueDate,
      amountCents: s.remainingCents,
      label: `fatura ${s.cardName}`,
    });
  }

  /** primeiro dia (na janela) em que o saldo disponível da conta fica negativo */
  const shortfallOf = (accountId: string) => {
    const f = flows.get(accountId);
    if (!f || !f.outflows.length) return null;
    let bal = available.get(accountId) ?? 0;
    const days = [...new Set([...f.outflows, ...f.inflows].map((x) => x.date))].sort();
    for (const d of days) {
      bal += f.inflows.filter((x) => x.date === d).reduce((a, x) => a + x.amountCents, 0);
      const outs = f.outflows.filter((x) => x.date === d);
      bal -= outs.reduce((a, x) => a + x.amountCents, 0);
      if (bal < 0 && outs.length) {
        const dueUpTo = f.outflows.filter((x) => x.date <= d).sort((x, y) => x.date.localeCompare(y.date) || y.amountCents - x.amountCents);
        return { date: d, missing: -bal, items: dueUpTo };
      }
    }
    return null;
  };

  /** contas com sobra na janela (para sugerir de onde transferir) */
  const surplus = (excludeId: string) =>
    accounts
      .filter((a) => a.id !== excludeId)
      .map((a) => {
        const f = flows.get(a.id);
        const outs = f ? f.outflows.reduce((s, x) => s + x.amountCents, 0) : 0;
        return { name: a.name, free: (available.get(a.id) ?? 0) - outs };
      })
      .filter((x) => x.free >= 50_00) // sobra pequena não vale sugerir
      .sort((x, y) => y.free - x.free)
      .slice(0, 2);

  const out: AlertItem[] = [];
  const shortfallSentFor = new Set<string>();

  /* ---- 1) fatura vence amanhã ---- */
  for (const s of input.statements.filter((x) => x.dueDate === tomorrow && x.remainingCents > 0).sort((a, b) => b.remainingCents - a.remainingCents)) {
    const sf = s.paymentAccountId ? shortfallOf(s.paymentAccountId) : null;
    const lacks = sf && sf.date <= tomorrow;
    let body = `${brl(s.remainingCents)}, paga pela conta ${accName(s.paymentAccountId)}.`;
    if (lacks) {
      const don = surplus(s.paymentAccountId!);
      body += ` O saldo não cobre: faltam ${brl(sf.missing)}.`;
      if (don.length) body += ` Dá para transferir de ${joinPt(don.map((d) => `${d.name} (${brl(d.free)})`))}.`;
      shortfallSentFor.add(s.paymentAccountId!);
    } else if (s.paymentAccountId) {
      body += ` Saldo disponível na conta: ${brl(available.get(s.paymentAccountId) ?? 0)}.`;
    }
    out.push({
      key: `statement-due:${s.id}`,
      kind: "statement-due",
      severity: lacks ? "danger" : "warning",
      title: `Fatura ${s.cardName} vence amanhã`,
      body,
      url: `/cartoes/${s.cardId}`,
    });
  }

  /* ---- 2) saldo não cobre o que sai nos próximos dias ---- */
  for (const a of accounts) {
    if (shortfallSentFor.has(a.id)) continue;
    const sf = shortfallOf(a.id);
    if (!sf) continue;
    const labels = [...new Set(sf.items.map((x) => x.label))];
    const total = sf.items.reduce((s, x) => s + x.amountCents, 0);
    const don = surplus(a.id);
    let body = `Até ${ddmm(sf.date)} saem ${brl(total)} (${joinPt(labels.slice(0, 3))}${labels.length > 3 ? "…" : ""}). Faltam ${brl(sf.missing)}.`;
    if (don.length) body += ` Dá para transferir de ${joinPt(don.map((d) => `${d.name} (${brl(d.free)})`))}.`;
    out.push({
      key: `shortfall:${a.id}:${sf.date}`,
      kind: "shortfall",
      severity: daysBetween(today, sf.date) <= 1 ? "danger" : "warning",
      title: `Saldo do ${a.name} não cobre o que vence ${dayWord(today, sf.date)}`,
      body,
      url: "/planejamento",
    });
  }

  /* ---- 3) contas a pagar amanhã ---- */
  const bills = input.pending.filter((p) => p.type === "expense" && p.date === tomorrow).sort((a, b) => b.amountCents - a.amountCents);
  if (bills.length) {
    const total = bills.reduce((s, x) => s + x.amountCents, 0);
    out.push({
      key: `bills-due:${tomorrow}`,
      kind: "bills-due",
      severity: "info",
      title: bills.length === 1 ? `Amanhã vence: ${bills[0].description}` : `Amanhã vencem ${bills.length} contas (${brl(total)})`,
      body: bills.slice(0, 4).map((b) => `${b.description} ${brl(b.amountCents)} (${accName(b.accountId)})`).join(" · ") + (bills.length > 4 ? " · …" : ""),
      url: "/planejamento",
    });
  }

  /* ---- 4) fatura vencida sem pagamento registrado ---- */
  for (const s of input.statements.filter((x) => x.remainingCents > 0)) {
    const late = daysBetween(s.dueDate, today);
    if (late !== 1 && late !== 3) continue;
    out.push({
      key: `statement-overdue:${s.id}:${late}`,
      kind: "statement-overdue",
      severity: "warning",
      title: `Fatura ${s.cardName} venceu ${late === 1 ? "ontem" : `em ${ddmm(s.dueDate)}`}`,
      body: `Ainda aparece em aberto: ${brl(s.remainingCents)}. Se já pagou, registre o pagamento no cartão para o saldo da conta ${accName(s.paymentAccountId)} ficar certo.`,
      url: `/cartoes/${s.cardId}`,
    });
  }

  /* ---- 5) receitas previstas ---- */
  for (const p of input.pending.filter((x) => x.type === "income")) {
    const late = daysBetween(p.date, today);
    if (late !== 0 && late !== 2) continue;
    out.push({
      key: `income-expected:${p.id}:${late}`,
      kind: "income-expected",
      severity: "info",
      title: late === 0 ? `Hoje deve cair: ${p.description}` : `${p.description} ainda não marcado como recebido`,
      body:
        late === 0
          ? `${brl(p.amountCents)} na conta ${accName(p.accountId)}. Quando cair, marque como recebido.`
          : `${brl(p.amountCents)} previsto para ${ddmm(p.date)} na conta ${accName(p.accountId)}. Já recebeu? Marque como recebido ou ajuste a data.`,
      url: "/movimentacoes",
    });
  }

  const order = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
