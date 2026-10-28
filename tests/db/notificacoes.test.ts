import { describe, expect, it } from "vitest";
import { asUser, createDb, USER_A, USER_B } from "./harness";

describe("notificações (push)", () => {
  it("cada usuário só vê e altera os próprios aparelhos; config privada fica fora da API", async () => {
    const db = await createDb();
    await asUser(db, USER_A, () =>
      db.query(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/a', 'k', 'x')`),
    );
    const seenByB = await asUser(db, USER_B, () => db.query(`select * from public.push_subscriptions`));
    expect(seenByB.rows).toHaveLength(0);
    const delByB = await asUser(db, USER_B, () => db.query(`delete from public.push_subscriptions`));
    expect(delByB.affectedRows).toBe(0);
    await expect(
      asUser(db, USER_B, () => db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${USER_A}', 'https://push.example/b', 'k', 'x')`)),
    ).rejects.toThrow();

    // segredo do agendador gerado automaticamente; usuários não leem a config
    const cfg = await db.query<{ v: string }>(`select value v from private.app_config where name = 'cron_secret'`);
    expect(cfg.rows[0].v).toMatch(/^[0-9a-f]{64}$/);
    await expect(asUser(db, USER_A, () => db.query(`select * from private.app_config`))).rejects.toThrow();
    await expect(asUser(db, USER_A, () => db.query(`select public.push_config()`))).rejects.toThrow();

    // chave pública: logado lê; set só pela função (service_role), sem sobrescrever
    await db.query(`select public.set_push_config('vapid_public', 'PUB1')`);
    await db.query(`select public.set_push_config('vapid_public', 'PUB2')`);
    const pub = await asUser(db, USER_A, () => db.query<{ k: string }>(`select public.get_vapid_public_key() k`));
    expect(pub.rows[0].k).toBe("PUB1");
    await expect(asUser(db, USER_A, () => db.query(`select public.set_push_config('vapid_private', 'x')`))).rejects.toThrow();
  });
});
