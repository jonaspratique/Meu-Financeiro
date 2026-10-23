/**
 * Restaura um backup JSON (Configurações → Exportar dados → Backup completo)
 * em um projeto Supabase — por exemplo, um projeto novo após perda de dados.
 *
 * Roda NA SUA MÁQUINA, nunca no navegador: usa a chave secreta (service role).
 *
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   RESTORE_USER_ID=<id do usuário em Authentication → Users> \
 *   node scripts/restore-backup.mjs caminho/meu-financeiro-backup-AAAA-MM-DD.json
 *
 * O destino deve estar com as migrações aplicadas e SEM dados desse usuário.
 * Os IDs originais são preservados; o dono passa a ser RESTORE_USER_ID.
 */
import { readFileSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESTORE_USER_ID } = process.env;
const file = process.argv[2];
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESTORE_USER_ID || !file) {
  console.error("Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... RESTORE_USER_ID=... node scripts/restore-backup.mjs backup.json");
  process.exit(1);
}

const backup = JSON.parse(readFileSync(file, "utf8"));
if (backup.app !== "meu-financeiro") throw new Error("Arquivo não parece ser um backup do Meu Financeiro.");
const data = backup.data;

async function insert(table, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, user_id: RESTORE_USER_ID }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  }
  console.log(`✔ ${table}: ${rows.length}`);
}

// Ordem respeita as chaves estrangeiras e as regras dos triggers:
// estornos depois das despesas; aportes depois de todos os saldos existirem.
const txns = data.transactions ?? [];
await insert("accounts", data.accounts ?? []);
await insert("categories", data.categories ?? []);
await insert("credit_cards", data.credit_cards ?? []);
await insert("recurring_rules", data.recurring_rules ?? []);
await insert("transactions", txns.filter((t) => t.type !== "refund"));
await insert("transactions", txns.filter((t) => t.type === "refund"));
await insert("transfers", data.transfers ?? []);
await insert("account_adjustments", data.account_adjustments ?? []);
await insert("savings_goals", data.savings_goals ?? []);
const moves = [...(data.savings_movements ?? [])].sort((a, b) =>
  a.date === b.date ? (a.kind === b.kind ? 0 : a.kind === "deposit" ? -1 : 1) : a.date < b.date ? -1 : 1,
);
await insert("savings_movements", moves);
// Fase 2: faturas antes das parcelas; compras antes dos estornos; pagamentos por último
const purchases = data.credit_card_purchases ?? [];
await insert("credit_card_statements", data.credit_card_statements ?? []);
await insert("credit_card_purchases", purchases.filter((p) => p.kind !== "refund"));
await insert("credit_card_purchases", purchases.filter((p) => p.kind === "refund"));
await insert("credit_card_installments", data.credit_card_installments ?? []);
await insert("statement_payments", data.statement_payments ?? []);
await insert("budgets", data.budgets ?? []);
console.log("Restauração concluída. Confira os saldos no app.");
