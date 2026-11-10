import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado a partir de um Server Component: o proxy renova a sessão.
        }
      },
    },
  });
}

/**
 * Garante usuário autenticado e retorna o client já autenticado.
 *
 * Usa getClaims(): o token (ES256) é verificado localmente com a chave pública
 * do projeto (em cache), sem ir ao servidor de autenticação a cada página.
 * O banco continua validando o mesmo token em toda consulta (RLS).
 */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect("/login");
  const user = { id: String(claims.sub), email: typeof claims.email === "string" ? claims.email : undefined };
  return { supabase, user };
});
