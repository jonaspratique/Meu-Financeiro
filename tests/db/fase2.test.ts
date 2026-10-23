import { beforeEach, describe, expect, it } from "vitest";
import { applyMigration, asUser, createDb, migrationFiles, one, USER_A, USER_B, type Db } from "./harness";

let db: Db;
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const A = <T>(fn: () => Promise<T>) => asUser(db, USER_A, fn);
const B = <T>(fn: () => Promise<T>) => asUser(db, USER_B, fn);

async function account(name: string, initial: number, date = "2026-01-01") {
  return (await one<{ id: string }>(db,
    `insert into accounts (name, type, initial_balance_cents, initial_balance_date) values ($1, 'checking', $2, $3) returning id`,
    [name, initial, date])).id;
}
const category = async (name: string) => (await one<{ id: string }>(db, `select id from categories where name = $1`, [name])).id;

async function card(name = "Nubank", closing = 5, due = 12, limit = 500_000) {
  return (await one<{ id: string }>(db,
    `insert into credit_cards (name, limit_cents, closing_day, due_day) values ($1, $2, $3, $4) returning id`,
    [name, limit, closing, due])).id;
}

async function purchase(p: {
  card: string; total: number; date: string; n?: number; kind?: string; cat?: string; refundOf?: string; id?: string;
}) {
  const r = await one<{ id: string }>(db,
    `select save_card_purchase($1, $2, $3::card_entry_kind, 'compra', $4, $5, $6, $7, $8) as id`,
    [p.id ?? null, p.card, p.kind ?? "purchase", p.total, p.date, p.n ?? 1, p.cat ?? (await category("Compras")), p.refundOf ?? null]);
  return r.id;
}

const installments = (purchaseId: string) =>
  q(`select i.number, i.amount_cents::int as amount, i.competence_date::text as competence, s.month::text as month,
            s.closing_date::text as closing, s.due_date::text as due
       from credit_card_installments i join credit_card_statements s on s.id = i.statement_id
      where i.purchase_id = $1 order by i.number`, [purchaseId]);

const cardUsed = async (cardId: string, asOf = "2030-01-01") =>
  Number((await one<{ used: string }>(db, `select used_cents as used from card_balances($1) where card_id = $2`, [asOf, cardId])).used);

const balance = async (accountId: string, asOf = "2030-01-01") =>
  Number((await one<{ b: string }>(db, `select balance_cents as b from account_balances($1) where account_id = $2`, [asOf, accountId])).b);

beforeEach(async () => {
  db = await createDb();
  await A(() => q(`select ensure_default_categories()`));
});

describe("atualização Fase 1 → Fase 2", () => {
  it("não altera dados nem saldos existentes", async () => {
    const files = migrationFiles();
    const old = await createDb({ upTo: 1 });
    db = old;
    const snapshot = await A(async () => {
      await q(`select ensure_default_categories()`);
      const a1 = await account("Corrente", 150_000, "2026-01-01");
      const a2 = await account("Poupança", 300_000, "2026-01-01");
      await q(`insert into transactions (type, description, amount_cents, date, status, paid_at, account_id, category_id)
               values ('income','Salário',500000,'2026-02-05','paid','2026-02-05',$1,$2),
                      ('expense','Mercado',45000,'2026-02-10','paid','2026-02-10',$1,$3),
                      ('expense','Luz',20000,'2026-02-20','pending',null,$1,$4)`,
        [a1, await category("Salário"), await category("Mercado"), await category("Contas da casa")]);
      await q(`insert into transfers (from_account_id,to_account_id,amount_cents,date,status,paid_at) values ($1,$2,10000,'2026-02-11','paid','2026-02-11')`, [a1, a2]);
      const g = await one<{ id: string }>(db, `insert into savings_goals (name, target_cents) values ('Emergência', 1000000) returning id`);
      await q(`insert into savings_movements (goal_id, account_id, kind, amount_cents, date) values ($1,$2,'deposit',100000,'2026-02-12')`, [g.id, a2]);
      return q(`select * from account_balances('2026-12-31') order by account_id`);
    });
    const countsBefore = await q(`select (select count(*) from transactions)::int t, (select count(*) from transfers)::int tr, (select count(*) from savings_movements)::int sm`);

    for (const f of files.slice(1)) await applyMigration(db, f);

    const after = await A(() => q(`select * from account_balances('2026-12-31') order by account_id`));
    expect(after).toEqual(snapshot);
    expect(await q(`select (select count(*) from transactions)::int t, (select count(*) from transfers)::int tr, (select count(*) from savings_movements)::int sm`)).toEqual(countsBefore);
    expect(await q(`select count(*)::int c from transactions where recurring_rule_id is not null or recurrence_detached`)).toEqual([{ c: 0 }]);
  });
});

describe("faturas: fechamento e vencimento", () => {
  it.each([
    // [data da compra, fechamento, vencimento, mês da fatura, fecha em, vence em]
    ["2026-10-04", 5, 12, "2026-10-01", "2026-10-05", "2026-10-12"],
    ["2026-10-05", 5, 12, "2026-11-01", "2026-11-05", "2026-11-12"], // no dia do fechamento → próxima
    ["2026-10-24", 25, 5, "2026-10-01", "2026-10-25", "2026-11-05"], // vence no mês seguinte
    ["2026-10-30", 25, 5, "2026-11-01", "2026-11-25", "2026-12-05"],
    ["2026-02-27", 31, 8, "2026-02-01", "2026-02-28", "2026-03-08"], // dia 31 em fevereiro
    ["2026-12-20", 15, 22, "2027-01-01", "2027-01-15", "2027-01-22"], // virada de ano
  ])("compra em %s (fecha %i, vence %i)", async (date, closing, due, month, closingDate, dueDate) => {
    await A(async () => {
      const c = await card("C", closing, due);
      const p = await purchase({ card: c, total: 1000, date });
      const [i] = await installments(p);
      expect(i).toMatchObject({ month, closing: closingDate, due: dueDate, competence: date });
    });
  });

  it("dia de vencimento igual ao de fechamento é recusado", async () => {
    await A(async () => {
      await expect(card("X", 10, 10)).rejects.toThrow(/diferente do dia de fechamento/);
    });
  });
});

describe("compras parceladas", () => {
  it("R$ 1.200 em 6x gera seis parcelas de R$ 200 em faturas consecutivas", async () => {
    await A(async () => {
      const c = await card();
      const p = await purchase({ card: c, total: 120_000, date: "2026-10-20", n: 6 });
      const rows = await installments(p);
      expect(rows.map((r) => r.amount)).toEqual([20_000, 20_000, 20_000, 20_000, 20_000, 20_000]);
      expect(rows.map((r) => r.month)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01"]);
      expect(rows.map((r) => r.competence)).toEqual(["2026-10-20", "2026-11-20", "2026-12-20", "2027-01-20", "2027-02-20", "2027-03-20"]);
      expect(await cardUsed(c)).toBe(120_000); // limite usado pelo total
    });
  });

  it("diferença de centavos vai para a 1ª parcela e a soma fecha exata", async () => {
    await A(async () => {
      const c = await card();
      const p = await purchase({ card: c, total: 10_000, date: "2026-10-01", n: 3 });
      const rows = await installments(p);
      expect(rows.map((r) => r.amount)).toEqual([3_334, 3_333, 3_333]);
      const p2 = await purchase({ card: c, total: 99_999, date: "2026-10-01", n: 12 });
      const sum = (await installments(p2)).reduce((a, r) => a + Number(r.amount), 0);
      expect(sum).toBe(99_999);
    });
  });

  it("parcela de dia 31 cai no último dia dos meses curtos", async () => {
    await A(async () => {
      const c = await card("C", 2, 10);
      const p = await purchase({ card: c, total: 3_000, date: "2026-01-31", n: 3 });
      expect((await installments(p)).map((r) => r.competence)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    });
  });

  it("editar regenera as parcelas e limpa faturas vazias", async () => {
    await A(async () => {
      const c = await card();
      const p = await purchase({ card: c, total: 60_000, date: "2026-10-01", n: 6 });
      await purchase({ id: p, card: c, total: 30_000, date: "2026-10-01", n: 3 });
      expect((await installments(p)).map((r) => r.amount)).toEqual([10_000, 10_000, 10_000]);
      expect(await q(`select count(*)::int c from credit_card_statements where card_id = $1`, [c])).toEqual([{ c: 3 }]);
      expect(await cardUsed(c)).toBe(30_000);
    });
  });

  it("excluir a compra remove as parcelas", async () => {
    await A(async () => {
      const c = await card();
      const p = await purchase({ card: c, total: 60_000, date: "2026-10-01", n: 6 });
      await q(`delete from credit_card_purchases where id = $1`, [p]);
      expect(await cardUsed(c)).toBe(0);
      expect(await q(`select count(*)::int c from credit_card_installments`)).toEqual([{ c: 0 }]);
    });
  });

  it("valida categoria, parcelamento e valor mínimo", async () => {
    await A(async () => {
      const c = await card();
      await expect(purchase({ card: c, total: 1000, date: "2026-10-01", cat: await category("Salário") })).rejects.toThrow(/categoria de despesa/);
      await expect(purchase({ card: c, total: 1000, date: "2026-10-01", n: 2, kind: "fee" })).rejects.toThrow(/Somente compras/);
      await expect(purchase({ card: c, total: 5, date: "2026-10-01", n: 6 })).rejects.toThrow(/Valor muito baixo/);
      await expect(purchase({ card: c, total: 1000, date: "2026-10-01", n: 73 })).rejects.toThrow(/parcelas inválido/);
    });
  });
});

describe("estornos e ajustes no cartão", () => {
  it("estorno vira crédito na fatura, herda a categoria e tem limite", async () => {
    await A(async () => {
      const c = await card();
      const lazer = await category("Lazer");
      const p = await purchase({ card: c, total: 30_000, date: "2026-10-01", n: 3, cat: lazer });
      const r = await purchase({ card: c, total: 10_000, date: "2026-10-15", kind: "refund", refundOf: p });
      const [ri] = await installments(r);
      expect(ri).toMatchObject({ amount: -10_000, month: "2026-11-01" });
      expect((await one<{ category_id: string }>(db, `select category_id from credit_card_purchases where id = $1`, [r])).category_id).toBe(lazer);
      expect(await cardUsed(c)).toBe(20_000);
      await expect(purchase({ card: c, total: 20_001, date: "2026-10-16", kind: "refund", refundOf: p })).rejects.toThrow(/ultrapassar/);
      // reduzir a compra abaixo do estornado é bloqueado
      await expect(purchase({ id: p, card: c, total: 9_000, date: "2026-10-01", n: 1, cat: lazer })).rejects.toThrow(/estornos maiores/);
    });
  });

  it("tarifa soma e crédito subtrai", async () => {
    await A(async () => {
      const c = await card();
      await purchase({ card: c, total: 2_500, date: "2026-10-01", kind: "fee", cat: await category("Impostos e taxas") });
      await purchase({ card: c, total: 1_000, date: "2026-10-01", kind: "credit" });
      expect(await cardUsed(c)).toBe(1_500);
    });
  });
});

describe("pagamento de fatura", () => {
  it("parcial: reduz conta e dívida, sem duplicar despesa; histórico por data", async () => {
    await A(async () => {
      const acc = await account("Corrente", 500_000);
      const c = await card();
      const p = await purchase({ card: c, total: 120_000, date: "2026-10-20", n: 6 });
      const stmt = (await one<{ statement_id: string }>(db,
        `select statement_id from credit_card_installments where purchase_id = $1 and number = 1`, [p])).statement_id;

      await q(`insert into statement_payments (statement_id, account_id, amount_cents, date) values ($1,$2,15000,'2026-11-10')`, [stmt, acc]);
      const t = await one<Record<string, string>>(db, `select * from credit_card_statement_totals where statement_id = $1`, [stmt]);
      expect(Number(t.charges_cents)).toBe(20_000);
      expect(Number(t.payments_cents)).toBe(15_000);
      expect(await balance(acc)).toBe(485_000);
      expect(await balance(acc, "2026-11-09")).toBe(500_000);
      expect(await cardUsed(c)).toBe(105_000);
      expect(await cardUsed(c, "2026-11-09")).toBe(120_000);
      expect(await cardUsed(c, "2026-10-19")).toBe(0); // antes da compra não havia dívida

      await q(`insert into statement_payments (statement_id, account_id, amount_cents, date) values ($1,$2,5000,'2026-11-12')`, [stmt, acc]);
      expect(await cardUsed(c)).toBe(100_000);
      // nenhuma despesa nova foi criada na conta
      expect(await q(`select count(*)::int c from transactions`)).toEqual([{ c: 0 }]);
      // conta com pagamento não pode ser excluída
      await expect(q(`delete from accounts where id = $1`, [acc])).rejects.toThrow();
    });
  });

  it("aporte em reserva considera o pagamento da fatura no saldo livre", async () => {
    await A(async () => {
      const acc = await account("Corrente", 100_000);
      const c = await card();
      const p = await purchase({ card: c, total: 80_000, date: "2026-01-02" });
      const stmt = (await one<{ statement_id: string }>(db, `select statement_id from credit_card_installments where purchase_id = $1`, [p])).statement_id;
      await q(`insert into statement_payments (statement_id, account_id, amount_cents, date) values ($1,$2,80000,'2026-01-10')`, [stmt, acc]);
      const g = await one<{ id: string }>(db, `insert into savings_goals (name, target_cents) values ('X', 100000) returning id`);
      await expect(q(`insert into savings_movements (goal_id, account_id, kind, amount_cents, date) values ($1,$2,'deposit',20001,'2026-01-11')`, [g.id, acc]))
        .rejects.toThrow(/Saldo livre insuficiente/);
    });
  });
});

describe("recorrências", () => {
  async function rule(extra: Record<string, unknown> = {}) {
    const acc = (extra.account_id as string) ?? (await account("Conta", 0));
    const cols = { type: "expense", description: "Aluguel", amount_cents: 150_000, category_id: await category("Moradia"),
      account_id: acc, frequency: "monthly", start_date: "2026-01-31", ...extra };
    const keys = Object.keys(cols);
    const r = await one<{ id: string }>(db,
      `insert into recurring_rules (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
      Object.values(cols));
    return { id: r.id, acc };
  }
  const occurrences = (ruleId: string) =>
    q(`select occurrence_date::text d, status, amount_cents::int a from transactions where recurring_rule_id = $1 order by 1`, [ruleId]);

  it("gera ocorrências previstas, ancoradas no dia, sem marcar como pago e sem duplicar", async () => {
    await A(async () => {
      const r = await rule();
      expect(Number((await one<{ n: number }>(db, `select generate_recurring('2026-01-15','2026-04-30') n`)).n)).toBe(4);
      expect(await occurrences(r.id)).toEqual([
        { d: "2026-01-31", status: "pending", a: 150_000 },
        { d: "2026-02-28", status: "pending", a: 150_000 },
        { d: "2026-03-31", status: "pending", a: 150_000 },
        { d: "2026-04-30", status: "pending", a: 150_000 },
      ]);
      expect(Number((await one<{ n: number }>(db, `select generate_recurring('2026-01-15','2026-04-30') n`)).n)).toBe(0);
      expect(await balance(r.acc)).toBe(0); // previstas não mexem no saldo
    });
  });

  it("ocorrência excluída não volta; respeita data final; semanal e anual", async () => {
    await A(async () => {
      const r = await rule({ end_date: "2026-05-15" });
      await q(`select generate_recurring('2026-01-01','2026-03-31')`);
      await q(`delete from transactions where recurring_rule_id = $1 and occurrence_date = '2026-02-28'`, [r.id]);
      await q(`select generate_recurring('2026-01-01','2026-12-31')`);
      expect((await occurrences(r.id)).map((o) => o.d)).toEqual(["2026-01-31", "2026-03-31", "2026-04-30"]);

      const w = await rule({ account_id: r.acc, frequency: "weekly", interval_count: 2, start_date: "2026-01-05" });
      await q(`select generate_recurring('2026-01-01','2026-02-05')`);
      expect((await occurrences(w.id)).map((o) => o.d)).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);

      const y = await rule({ account_id: r.acc, frequency: "yearly", start_date: "2024-02-29" });
      await q(`select generate_recurring('2026-01-01','2026-12-31')`);
      expect((await occurrences(y.id)).map((o) => o.d)).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
    });
  });

  it("receita recorrente usa categoria de receita", async () => {
    await A(async () => {
      const acc = await account("Salário conta", 0);
      await expect(rule({ type: "income", account_id: acc })).rejects.toThrow(/categoria de receita/);
      const s = await rule({ type: "income", account_id: acc, category_id: await category("Salário"), start_date: "2026-01-05" });
      await q(`select generate_recurring('2026-01-01','2026-01-31')`);
      expect(await q(`select type from transactions where recurring_rule_id = $1`, [s.id])).toEqual([{ type: "income" }]);
    });
  });

  it("no cartão, só gera cobranças até hoje", async () => {
    await A(async () => {
      const c = await card();
      const r = await rule({ account_id: null, card_id: c, description: "Streaming", amount_cents: 3_990, start_date: "2026-08-10" });
      await q(`select generate_recurring('2026-10-21','2026-12-31')`);
      const rows = await q(`select occurrence_date::text d from credit_card_purchases where recurring_rule_id = $1 order by 1`, [r.id]);
      expect(rows.map((x) => x.d)).toEqual(["2026-08-10", "2026-09-10", "2026-10-10"]);
      expect(await cardUsed(c)).toBe(3 * 3_990);
      await q(`select generate_recurring('2026-10-21','2026-12-31')`);
      expect(await cardUsed(c)).toBe(3 * 3_990);
    });
  });

  it("encerrar a partir de uma data preserva o que já foi pago", async () => {
    await A(async () => {
      const r = await rule();
      await q(`select generate_recurring('2026-01-01','2026-06-30')`);
      await q(`update transactions set status='paid', paid_at=occurrence_date where recurring_rule_id = $1 and occurrence_date <= '2026-03-31'`, [r.id]);
      await q(`update transactions set status='paid', paid_at='2026-05-01' where recurring_rule_id = $1 and occurrence_date = '2026-05-31'`, [r.id]);
      await q(`select end_recurring_rule($1, '2026-03-31')`, [r.id]);
      await q(`select generate_recurring('2026-01-01','2026-12-31')`);
      expect((await occurrences(r.id)).map((o) => `${o.d}:${o.status}`)).toEqual([
        "2026-01-31:paid", "2026-02-28:paid", "2026-03-31:paid", "2026-05-31:paid",
      ]);
      expect((await one<{ end_date: string }>(db, `select end_date::text from recurring_rules where id = $1`, [r.id])).end_date).toBe("2026-03-30");
    });
  });

  it("editar 'esta e as próximas' cria nova série sem duplicar", async () => {
    await A(async () => {
      const r = await rule();
      await q(`select generate_recurring('2026-01-01','2026-05-31')`);
      await q(`update transactions set status='paid', paid_at=occurrence_date where recurring_rule_id = $1 and occurrence_date = '2026-01-31'`, [r.id]);
      const edited = (await one<{ id: string }>(db, `select id from transactions where recurring_rule_id = $1 and occurrence_date = '2026-03-31'`, [r.id])).id;
      const newRule = (await one<{ id: string }>(db,
        `select split_recurring_rule($1, '2026-03-31', '2026-03-31', 'Aluguel reajustado', 165000, $2, $3, null, 'pix', 'monthly', 1, null, null, $4) id`,
        [r.id, await category("Moradia"), r.acc, edited])).id;
      await q(`select generate_recurring('2026-01-01','2026-05-31')`);
      const all = await q(`select occurrence_date::text d, amount_cents::int a, recurring_rule_id = $1 as nova
                             from transactions order by occurrence_date`, [newRule]);
      expect(all).toEqual([
        { d: "2026-01-31", a: 150_000, nova: false },
        { d: "2026-02-28", a: 150_000, nova: false },
        { d: "2026-03-31", a: 165_000, nova: true },
        { d: "2026-04-30", a: 165_000, nova: true },
        { d: "2026-05-31", a: 165_000, nova: true },
      ]);
    });
  });
});

describe("orçamentos", () => {
  it("só categorias de despesa; cópia idempotente para o mês seguinte", async () => {
    await A(async () => {
      await expect(q(`insert into budgets (month, category_id, amount_cents) values ('2026-10-01', $1, 100)`, [await category("Salário")]))
        .rejects.toThrow(/categoria de despesa/);
      await q(`insert into budgets (month, category_id, amount_cents) values ('2026-10-01', $1, 120000), ('2026-10-01', $2, 80000)`,
        [await category("Alimentação"), await category("Transporte")]);
      expect((await one<{ n: number }>(db, `select copy_budgets('2026-10-01','2026-11-01') n`)).n).toBe(2);
      expect((await one<{ n: number }>(db, `select copy_budgets('2026-10-01','2026-11-01') n`)).n).toBe(0);
      expect(await q(`select count(*)::int c from budgets where month = '2026-11-01'`)).toEqual([{ c: 2 }]);
      await expect(q(`insert into budgets (month, category_id, amount_cents) values ('2026-10-15', $1, 100)`, [await category("Lazer")])).rejects.toThrow();
    });
  });
});

describe("segurança (RLS) da Fase 2", () => {
  it("dados de cartão, recorrência e orçamento são isolados por usuário", async () => {
    const { c } = await A(async () => {
      const c = await card();
      await purchase({ card: c, total: 10_000, date: "2026-10-01", n: 2 });
      await q(`insert into budgets (month, category_id, amount_cents) values ('2026-10-01', $1, 100)`, [await category("Lazer")]);
      return { c };
    });
    await B(async () => {
      await q(`select ensure_default_categories()`);
      for (const t of ["credit_cards", "credit_card_statements", "credit_card_purchases", "credit_card_installments",
        "statement_payments", "recurring_rules", "budgets", "credit_card_statement_totals"]) {
        expect(await q(`select * from ${t}`), t).toHaveLength(0);
      }
      expect(await q(`select * from card_balances('2030-01-01')`)).toHaveLength(0);
      await expect(q(`select save_card_purchase(null, $1, 'purchase', 'x', 100, '2026-10-01', 1, $2)`, [c, await category("Lazer")]))
        .rejects.toThrow(/Cartão não encontrado/);
      expect(Number((await one<{ n: number }>(db, `select generate_recurring('2026-01-01','2026-12-31') n`)).n)).toBe(0);
    });
    await asUser(db, null, async () => {
      await expect(q(`select * from credit_cards`)).rejects.toThrow(/permission denied/);
      await expect(q(`select * from credit_card_statement_totals`)).rejects.toThrow(/permission denied/);
      await expect(q(`select generate_recurring('2026-01-01','2026-12-31')`)).rejects.toThrow(/permission denied/);
    });
  });
});
