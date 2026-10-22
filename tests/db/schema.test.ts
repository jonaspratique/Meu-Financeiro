import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, one, USER_A, USER_B, type Db } from "./harness";

let db: Db;

async function q(sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}

async function account(name: string, initial: number, date = "2026-01-01", extra = "") {
  const r = await one<{ id: string }>(
    db,
    `insert into accounts (name, type, initial_balance_cents, initial_balance_date${extra ? ", is_operational" : ""})
     values ($1, 'checking', $2, $3${extra ? ", " + extra : ""}) returning id`,
    [name, initial, date],
  );
  return r.id;
}

async function category(name: string) {
  return (await one<{ id: string }>(db, `select id from categories where name = $1`, [name])).id;
}

async function txn(p: {
  type: "income" | "expense" | "refund";
  amount: number;
  account: string;
  category?: string | null;
  date?: string;
  status?: "paid" | "pending" | "cancelled";
  paidAt?: string | null;
  refundOf?: string;
}) {
  const status = p.status ?? "paid";
  const date = p.date ?? "2026-03-10";
  const paidAt = p.paidAt !== undefined ? p.paidAt : status === "paid" ? date : null;
  const r = await one<{ id: string }>(
    db,
    `insert into transactions (type, description, amount_cents, date, status, paid_at, account_id, category_id, refund_of_id)
     values ($1, 'teste', $2, $3, $4, $5, $6, $7, $8) returning id`,
    [p.type, p.amount, date, status, paidAt, p.account, p.category ?? null, p.refundOf ?? null],
  );
  return r.id;
}

async function balances(asOf = "2026-12-31") {
  const rows = await q(`select account_id, balance_cents, reserved_cents from account_balances($1)`, [asOf]);
  return Object.fromEntries(
    rows.map((r) => [r.account_id as string, { balance: Number(r.balance_cents), reserved: Number(r.reserved_cents) }]),
  );
}

const A = <T>(fn: () => Promise<T>) => asUser(db, USER_A, fn);

beforeEach(async () => {
  db = await createDb();
  await A(() => q(`select ensure_default_categories()`));
});

describe("categorias padrão", () => {
  it("são criadas uma única vez (idempotente)", async () => {
    await A(async () => {
      const before = await q(`select count(*)::int c from categories`);
      await q(`select ensure_default_categories()`);
      await q(`select ensure_default_categories()`);
      const after = await q(`select count(*)::int c from categories`);
      expect(after[0].c).toBe(before[0].c);
      expect(before[0].c).toBeGreaterThan(10);
    });
  });
});

describe("saldo das contas", () => {
  it("considera apenas movimentações efetivadas", async () => {
    await A(async () => {
      const acc = await account("Nubank", 100_000);
      await txn({ type: "income", amount: 500_000, account: acc, category: await category("Salário") });
      await txn({ type: "expense", amount: 8_500, account: acc, category: await category("Transporte") });
      await txn({ type: "expense", amount: 20_000, account: acc, category: await category("Lazer"), status: "pending" });
      await txn({ type: "expense", amount: 99_999, account: acc, category: await category("Lazer"), status: "cancelled" });
      expect((await balances())[acc].balance).toBe(100_000 + 500_000 - 8_500);
    });
  });

  it("usa a data de pagamento (caixa) e respeita a data de referência", async () => {
    await A(async () => {
      const acc = await account("Itaú", 0);
      await txn({ type: "expense", amount: 10_000, account: acc, category: await category("Mercado"), date: "2026-03-28", paidAt: "2026-04-02" });
      expect((await balances("2026-03-31"))[acc].balance).toBe(0);
      expect((await balances("2026-04-02"))[acc].balance).toBe(-10_000);
    });
  });

  it("ignora movimentações anteriores à data do saldo inicial", async () => {
    await A(async () => {
      const acc = await account("Inter", 50_000, "2026-03-01");
      await txn({ type: "expense", amount: 7_000, account: acc, category: await category("Mercado"), date: "2026-02-20" });
      await txn({ type: "expense", amount: 3_000, account: acc, category: await category("Mercado"), date: "2026-03-01" });
      expect((await balances())[acc].balance).toBe(47_000);
      // antes da data do saldo inicial a conta não existe no cálculo
      expect((await balances("2026-02-28"))[acc]).toBeUndefined();
    });
  });

  it("reflete edição e exclusão de lançamentos", async () => {
    await A(async () => {
      const acc = await account("C6", 0);
      const id = await txn({ type: "expense", amount: 10_000, account: acc, category: await category("Lazer") });
      await q(`update transactions set amount_cents = 12_345 where id = $1`, [id]);
      expect((await balances())[acc].balance).toBe(-12_345);
      await q(`update transactions set status = 'pending', paid_at = null where id = $1`, [id]);
      expect((await balances())[acc].balance).toBe(0);
      await q(`update transactions set status = 'paid', paid_at = '2026-03-10' where id = $1`, [id]);
      await q(`delete from transactions where id = $1`, [id]);
      expect((await balances())[acc].balance).toBe(0);
    });
  });
});

describe("transferências internas", () => {
  it("movem saldo entre contas sem alterar o total", async () => {
    await A(async () => {
      const a = await account("Origem", 100_000);
      const b = await account("Destino", 0);
      await q(
        `insert into transfers (from_account_id, to_account_id, amount_cents, date, status, paid_at)
         values ($1, $2, 30_000, '2026-03-05', 'paid', '2026-03-05')`,
        [a, b],
      );
      await q(
        `insert into transfers (from_account_id, to_account_id, amount_cents, date, status)
         values ($1, $2, 5_000, '2026-03-06', 'pending')`,
        [a, b],
      );
      const bal = await balances();
      expect(bal[a].balance).toBe(70_000);
      expect(bal[b].balance).toBe(30_000);
      expect(bal[a].balance + bal[b].balance).toBe(100_000);
    });
  });

  it("não aceita transferir para a mesma conta", async () => {
    await A(async () => {
      const a = await account("Única", 0);
      await expect(
        q(`insert into transfers (from_account_id, to_account_id, amount_cents, date, status, paid_at) values ($1, $1, 100, '2026-03-01', 'paid', '2026-03-01')`, [a]),
      ).rejects.toThrow(/transfers_distinct_accounts/);
    });
  });
});

describe("integridade dos lançamentos", () => {
  it("exige paid_at quando pago e proíbe quando pendente", async () => {
    await A(async () => {
      const acc = await account("X", 0);
      const cat = await category("Lazer");
      await expect(txn({ type: "expense", amount: 100, account: acc, category: cat, status: "paid", paidAt: null })).rejects.toThrow(/paid_consistency/);
      await expect(txn({ type: "expense", amount: 100, account: acc, category: cat, status: "pending", paidAt: "2026-03-01" })).rejects.toThrow(/paid_consistency/);
    });
  });

  it("rejeita valor zero ou negativo", async () => {
    await A(async () => {
      const acc = await account("X", 0);
      await expect(txn({ type: "expense", amount: 0, account: acc, category: await category("Lazer") })).rejects.toThrow();
      await expect(txn({ type: "expense", amount: -5, account: acc, category: await category("Lazer") })).rejects.toThrow();
    });
  });

  it("rejeita categoria de tipo diferente", async () => {
    await A(async () => {
      const acc = await account("X", 0);
      await expect(txn({ type: "expense", amount: 100, account: acc, category: await category("Salário") })).rejects.toThrow(/não é do tipo despesa/);
    });
  });
});

describe("estornos", () => {
  it("devolvem saldo, herdam a categoria e não ultrapassam o original", async () => {
    await A(async () => {
      const acc = await account("X", 0);
      const lazer = await category("Lazer");
      const exp = await txn({ type: "expense", amount: 10_000, account: acc, category: lazer });
      const ref = await txn({ type: "refund", amount: 4_000, account: acc, refundOf: exp });
      expect((await one<{ category_id: string }>(db, `select category_id from transactions where id = $1`, [ref])).category_id).toBe(lazer);
      expect((await balances())[acc].balance).toBe(-6_000);
      await expect(txn({ type: "refund", amount: 6_001, account: acc, refundOf: exp })).rejects.toThrow(/ultrapassar/);
      await txn({ type: "refund", amount: 6_000, account: acc, refundOf: exp });
      expect((await balances())[acc].balance).toBe(0);
    });
  });

  it("impedem cancelar ou reduzir a despesa original", async () => {
    await A(async () => {
      const acc = await account("X", 0);
      const exp = await txn({ type: "expense", amount: 10_000, account: acc, category: await category("Lazer") });
      await txn({ type: "refund", amount: 4_000, account: acc, refundOf: exp });
      await expect(q(`update transactions set status='cancelled', paid_at=null where id=$1`, [exp])).rejects.toThrow(/possui estornos/);
      await expect(q(`update transactions set amount_cents=3_000 where id=$1`, [exp])).rejects.toThrow(/possui estornos/);
      await expect(q(`delete from transactions where id=$1`, [exp])).rejects.toThrow();
    });
  });

  it("só podem ser feitos sobre despesas", async () => {
    await A(async () => {
      const acc = await account("X", 0);
      const inc = await txn({ type: "income", amount: 10_000, account: acc, category: await category("Salário") });
      await expect(txn({ type: "refund", amount: 100, account: acc, refundOf: inc })).rejects.toThrow(/Só é possível estornar despesas/);
    });
  });
});

describe("conciliação", () => {
  it("ajuste altera o saldo e precisa ser coerente", async () => {
    await A(async () => {
      const acc = await account("X", 10_000);
      await q(
        `insert into account_adjustments (account_id, date, amount_cents, reason, system_balance_cents, reported_balance_cents)
         values ($1, '2026-03-01', -250, 'Tarifa não registrada', 10_000, 9_750)`,
        [acc],
      );
      expect((await balances())[acc].balance).toBe(9_750);
      await expect(
        q(`insert into account_adjustments (account_id, date, amount_cents, reason, system_balance_cents, reported_balance_cents)
           values ($1, '2026-03-01', 100, 'errado', 0, 50)`, [acc]),
      ).rejects.toThrow(/adjustments_consistency/);
      await expect(
        q(`insert into account_adjustments (account_id, date, amount_cents, reason, system_balance_cents, reported_balance_cents)
           values ($1, '2025-12-01', 100, 'antes do inicio', 0, 100)`, [acc]),
      ).rejects.toThrow(/anterior à data do saldo inicial/);
    });
  });
});

describe("reservas", () => {
  async function goal(name: string, target = 1_000_000) {
    return (await one<{ id: string }>(db, `insert into savings_goals (name, target_cents) values ($1, $2) returning id`, [name, target])).id;
  }
  async function move(goalId: string, acc: string, kind: "deposit" | "withdrawal", amount: number, date = "2026-03-10") {
    return (await one<{ id: string }>(
      db,
      `insert into savings_movements (goal_id, account_id, kind, amount_cents, date) values ($1, $2, $3, $4, $5) returning id`,
      [goalId, acc, kind, amount, date],
    )).id;
  }

  it("aporte etiqueta saldo sem criar dinheiro", async () => {
    await A(async () => {
      const acc = await account("Conta", 100_000);
      const g = await goal("Emergência");
      await move(g, acc, "deposit", 40_000);
      const bal = (await balances())[acc];
      expect(bal.balance).toBe(100_000); // saldo da conta não muda
      expect(bal.reserved).toBe(40_000); // parte dele está reservada
    });
  });

  it("não permite aportar mais que o saldo livre", async () => {
    await A(async () => {
      const acc = await account("Conta", 100_000);
      const g1 = await goal("Viagem");
      const g2 = await goal("Carro");
      await move(g1, acc, "deposit", 70_000);
      await expect(move(g2, acc, "deposit", 30_001)).rejects.toThrow(/Saldo livre insuficiente/);
      await move(g2, acc, "deposit", 30_000);
    });
  });

  it("não permite retirar mais que o guardado", async () => {
    await A(async () => {
      const acc = await account("Conta", 100_000);
      const g = await goal("Viagem");
      await move(g, acc, "deposit", 10_000);
      await expect(move(g, acc, "withdrawal", 10_001)).rejects.toThrow(/maior que o valor guardado/);
      await move(g, acc, "withdrawal", 10_000);
      expect((await balances())[acc].reserved).toBe(0);
    });
  });

  it("não permite excluir um aporte que deixaria a reserva negativa", async () => {
    await A(async () => {
      const acc = await account("Conta", 100_000);
      const g = await goal("Viagem");
      const dep = await move(g, acc, "deposit", 10_000);
      await move(g, acc, "withdrawal", 5_000);
      await expect(q(`delete from savings_movements where id = $1`, [dep])).rejects.toThrow(/maior que o valor guardado/);
    });
  });

  it("excluir a reserva libera o saldo reservado", async () => {
    await A(async () => {
      const acc = await account("Conta", 100_000);
      const g = await goal("Viagem");
      await move(g, acc, "deposit", 10_000);
      await move(g, acc, "withdrawal", 4_000);
      await q(`delete from savings_goals where id = $1`, [g]);
      expect((await balances())[acc].reserved).toBe(0);
    });
  });
});

describe("segurança (RLS)", () => {
  it("um usuário não enxerga nem altera dados de outro", async () => {
    const accA = await A(() => account("Conta A", 100_000));
    await asUser(db, USER_B, async () => {
      expect(await q(`select * from accounts`)).toHaveLength(0);
      expect(await q(`select * from account_balances('2026-12-31')`)).toHaveLength(0);
      const upd = await db.query(`update accounts set name = 'hack' where id = $1`, [accA]);
      expect(upd.affectedRows).toBe(0);
      await q(`select ensure_default_categories()`);
      const cat = (await one<{ id: string }>(db, `select id from categories where name = 'Lazer'`)).id;
      // tentar lançar na conta do usuário A: bloqueado
      await expect(txn({ type: "expense", amount: 100, account: accA, category: cat })).rejects.toThrow();
      // tentar gravar com user_id de outro: bloqueado pela política
      await expect(
        q(`insert into accounts (user_id, name, type, initial_balance_date) values ($1, 'x', 'cash', '2026-01-01')`, [USER_A]),
      ).rejects.toThrow(/row-level security/);
    });
    await A(async () => {
      expect((await q(`select name from accounts`))[0].name).toBe("Conta A");
    });
  });

  it("usuário anônimo não tem acesso", async () => {
    await A(() => account("Conta A", 100_000));
    await asUser(db, null, async () => {
      await expect(q(`select * from accounts`)).rejects.toThrow(/permission denied/);
      await expect(q(`select * from account_balances()`)).rejects.toThrow(/permission denied/);
    });
  });
});
