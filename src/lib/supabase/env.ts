/**
 * Configuração pública do Supabase.
 *
 * A URL e a chave PUBLICÁVEL foram feitas para ficar no navegador (os dados são
 * protegidos pelo login + Row Level Security), então podem ter um valor padrão
 * no código. Variáveis de ambiente, se definidas, têm prioridade.
 * Nunca coloque aqui a chave secreta (service role).
 */
const DEFAULT_URL = "https://iwkimregpofvoemdplps.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_nGONYHmY9qshsV2sudZ7OA_BbsyvwHj";

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    DEFAULT_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Variáveis do Supabase ausentes. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return { url, key };
}
