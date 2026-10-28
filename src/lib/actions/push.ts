"use server";

import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { dbError } from "./errors";

type Result<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Chama a Edge Function "alerts" com a sessão do usuário. */
async function callAlerts(mode: "init" | "test") {
  const { supabase } = await requireUser();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false as const, error: "Sessão expirada. Entre novamente." };
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/functions/v1/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: key },
    body: JSON.stringify({ mode }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { ok: false as const, error: String(body.error ?? "Não foi possível falar com o serviço de notificações.") };
  return { ok: true as const, body };
}

/** Chave pública VAPID (gerada no servidor na primeira vez). */
export async function getPushPublicKey(): Promise<Result<string>> {
  const { supabase } = await requireUser();
  const { data } = await supabase.rpc("get_vapid_public_key");
  if (typeof data === "string" && data) return { ok: true, data };
  const r = await callAlerts("init");
  if (!r.ok) return r;
  return { ok: true, data: String(r.body.publicKey) };
}

const subSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  userAgent: z.string().max(300).optional(),
});

export async function savePushSubscription(input: z.input<typeof subSchema>): Promise<Result> {
  const p = subSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Inscrição de notificação inválida." };
  const { supabase, user } = await requireUser();
  // o mesmo aparelho pode se inscrever de novo: troca as chaves
  await supabase.from("push_subscriptions").delete().eq("endpoint", p.data.endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({
    user_id: user.id,
    endpoint: p.data.endpoint,
    p256dh: p.data.keys.p256dh,
    auth: p.data.keys.auth,
    user_agent: p.data.userAgent ?? null,
  });
  if (error) return { ok: false, error: dbError(error) };
  return { ok: true, message: "Notificações ativadas neste aparelho" };
}

export async function removePushSubscription(endpoint: string): Promise<Result> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, error: dbError(error) };
  return { ok: true, message: "Notificações desativadas neste aparelho" };
}

export async function sendTestPush(): Promise<Result> {
  const r = await callAlerts("test");
  if (!r.ok) return r;
  return { ok: true, message: "Notificação de teste enviada" };
}

export async function countPushDevices(): Promise<number> {
  const { supabase } = await requireUser();
  const { count } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true });
  return count ?? 0;
}
