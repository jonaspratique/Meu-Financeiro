/**
 * Edge Function "alerts" — envia as notificações do Meu Financeiro (Web Push).
 *
 *  POST {mode:"cron"}  + header x-cron-secret   → roda os avisos do dia (pg_cron, 9h)
 *  POST {mode:"init"}  + Authorization do usuário → garante as chaves VAPID e devolve a pública
 *  POST {mode:"test"}  + Authorization do usuário → manda uma notificação de teste
 *
 * As regras dos avisos ficam em ./alerts.ts (cópia exata de src/lib/finance/alerts.ts).
 * As chaves VAPID são geradas aqui na primeira execução e guardadas em private.app_config.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { addDaysISO, buildAlerts, type AlertItem } from "./alerts.ts";

const SITE = "https://meu-financeiro-eight-zeta.vercel.app";
const MAX_PER_DAY = 6;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const todaySP = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function config(): Promise<Record<string, string>> {
  const { data, error } = await db.rpc("push_config");
  if (error) throw new Error(`config: ${error.message}`);
  return (data ?? {}) as Record<string, string>;
}

/** Garante as chaves VAPID (gera na 1ª vez) e configura o web-push. */
async function ensureVapid() {
  let cfg = await config();
  if (!cfg.vapid_public || !cfg.vapid_private) {
    const keys = webpush.generateVAPIDKeys();
    await db.rpc("set_push_config", { p_name: "vapid_private", p_value: keys.privateKey });
    await db.rpc("set_push_config", { p_name: "vapid_public", p_value: keys.publicKey });
    cfg = await config(); // se outra execução gravou antes, vale a que ficou no banco
  }
  webpush.setVapidDetails(SITE, cfg.vapid_public, cfg.vapid_private);
  return cfg;
}

async function userFromRequest(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data.user ?? null;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; failures: number };

/** Envia para todos os aparelhos do usuário; remove inscrições que expiraram. */
async function sendToUser(subs: Sub[], payload: { title: string; body: string; url: string; tag: string }, urgent = false) {
  let delivered = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        TTL: 12 * 60 * 60,
        urgency: urgent ? "high" : "normal",
      });
      delivered++;
      await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else await db.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
      console.error("push falhou", code, (e as Error).message);
    }
  }
  return delivered;
}

/** Monta os avisos do dia de um usuário a partir do banco. */
async function alertsFor(userId: string, today: string): Promise<AlertItem[]> {
  const [acc, bal, pend, st, cards] = await Promise.all([
    db.from("accounts").select("id, name, archived_at").eq("user_id", userId),
    db.rpc("account_balances", { p_as_of: today }),
    db
      .from("transactions")
      .select("id, type, amount_cents, date, account_id, description")
      .eq("user_id", userId)
      .eq("status", "pending")
      .in("type", ["income", "expense"])
      .gte("date", addDaysISO(today, -7))
      .lte("date", addDaysISO(today, 7)),
    db
      .from("credit_card_statement_totals")
      .select("statement_id, card_id, due_date, charges_cents, credits_cents, payments_cents")
      .eq("user_id", userId)
      .gte("due_date", addDaysISO(today, -5))
      .lte("due_date", addDaysISO(today, 7)),
    db.from("credit_cards").select("id, name, payment_account_id").eq("user_id", userId),
  ]);
  for (const r of [acc, bal, pend, st, cards]) if (r.error) throw new Error(r.error.message);
  const accounts = (acc.data ?? []).map((a) => ({ id: a.id, name: a.name, archived: a.archived_at != null }));
  const ids = new Set(accounts.map((a) => a.id));
  const cardById = new Map((cards.data ?? []).map((c) => [c.id, c]));
  return buildAlerts({
    today,
    accounts,
    balances: (bal.data ?? [])
      .filter((b: { account_id: string }) => ids.has(b.account_id))
      .map((b: { account_id: string; balance_cents: number; reserved_cents: number }) => ({
        accountId: b.account_id,
        balanceCents: Number(b.balance_cents),
        reservedCents: Number(b.reserved_cents),
      })),
    pending: (pend.data ?? []).map((t) => ({
      id: t.id,
      type: t.type,
      amountCents: Number(t.amount_cents),
      date: t.date,
      accountId: t.account_id,
      description: t.description,
    })),
    statements: (st.data ?? []).map((s) => {
      const card = cardById.get(s.card_id);
      return {
        id: s.statement_id,
        cardId: s.card_id,
        cardName: card?.name ?? "Cartão",
        paymentAccountId: card?.payment_account_id ?? null,
        dueDate: s.due_date,
        remainingCents: Number(s.charges_cents) - Number(s.credits_cents) - Number(s.payments_cents),
      };
    }),
  });
}

async function runCron() {
  await ensureVapid();
  const today = todaySP();
  const { data: subs, error } = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, failures");
  if (error) throw new Error(error.message);
  const byUser = new Map<string, Sub[]>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  const report: Record<string, unknown>[] = [];
  for (const [userId, userSubs] of byUser) {
    const alerts = await alertsFor(userId, today);
    const { data: sent } = await db.from("notification_log").select("key").eq("user_id", userId).eq("sent_on", today);
    const already = new Set((sent ?? []).map((r) => r.key));
    let count = 0;
    for (const a of alerts) {
      if (already.has(a.key) || count >= MAX_PER_DAY) continue;
      const ok = await sendToUser(userSubs, { title: a.title, body: a.body, url: a.url, tag: a.key }, a.severity === "danger");
      if (ok) {
        count++;
        await db.from("notification_log").upsert({ user_id: userId, key: a.key, sent_on: today, title: a.title }, { onConflict: "user_id,key,sent_on", ignoreDuplicates: true });
      }
    }
    report.push({ user: userId.slice(0, 8), alerts: alerts.length, sent: count, devices: userSubs.length });
  }
  return { today, report };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.mode === "cron") {
      const cfg = await config();
      if (!cfg.cron_secret || req.headers.get("x-cron-secret") !== cfg.cron_secret) return json({ error: "não autorizado" }, 401);
      return json(await runCron());
    }

    const user = await userFromRequest(req);
    if (!user) return json({ error: "não autorizado" }, 401);

    if (body.mode === "init") {
      const cfg = await ensureVapid();
      return json({ publicKey: cfg.vapid_public });
    }
    if (body.mode === "test") {
      await ensureVapid();
      const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, failures").eq("user_id", user.id);
      if (!subs?.length) return json({ error: "Nenhum aparelho com notificações ativadas." }, 400);
      const delivered = await sendToUser(subs, {
        title: "Notificações ativadas ✅",
        body: "Você vai receber às 9h os avisos de faturas, saldo, contas a pagar e receitas previstas.",
        url: "/",
        tag: "teste",
      });
      return json({ delivered, devices: subs.length });
    }
    return json({ error: "modo desconhecido" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
