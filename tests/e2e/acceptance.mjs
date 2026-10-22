/**
 * Teste de aceitação ponta a ponta (critérios da seção 19 do prompt).
 * Roda contra o app real + Supabase (local ou um projeto de testes — nunca o de produção).
 *
 *   E2E_URL=http://localhost:3000 E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/acceptance.mjs
 *
 * Requer um Chromium: `npx playwright install chromium` ou E2E_CHROMIUM=/caminho/do/chrome.
 * O usuário de teste deve começar SEM dados.
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const URL = process.env.E2E_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.env.E2E_SHOTS ?? "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
if (!EMAIL || !PASSWORD) throw new Error("Defina E2E_EMAIL e E2E_PASSWORD");

const browser = await chromium.launch({
  executablePath: process.env.E2E_CHROMIUM || undefined,
  args: process.env.E2E_CHROMIUM_ARGS ? JSON.parse(process.env.E2E_CHROMIUM_ARGS) : [],
  headless: true,
});
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["✔", name]);
    console.log("✔", name);
  } catch (e) {
    results.push(["✘", name]);
    console.error("✘", name, "\n ", e.message.split("\n").slice(0, 4).join("\n  "));
    await page.screenshot({ path: `${SHOTS}/falha-${results.length}.png`, fullPage: true }).catch(() => {});
    console.error("  erros no navegador:", pageErrors.slice(-5));
    if (process.env.E2E_DUMP) {
      const first = [...pending.keys()].find((r) => r.url().includes("_rsc"));
      if (first) (await import("node:fs")).writeFileSync(process.env.E2E_DUMP, JSON.stringify({ url: first.url(), headers: await first.allHeaders() }));
    }
    console.error("  rAF:", await page.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame(() => r("ok"))), new Promise((r) => setTimeout(() => r("TRAVADO"), 2000))])).catch((e) => e.message),
      "| visibilidade:", await page.evaluate(() => document.visibilityState).catch(() => "?"),
      "| dialog:", await page.evaluate(() => document.querySelector("[role=dialog]")?.innerText.replace(/\s+/g, " ").slice(0, 300)).catch(() => "?"));
    console.error("  requisições pendentes:", [...pending].map(([r, t]) => `${r.method()} ${r.url().replace(URL, "")} há ${Date.now() - t}ms`).slice(0, 12));
    console.error("  mutações:", await page.evaluate(() => window.__muts).catch(() => "?"));
    console.error("  url:", page.url(), "| dialogs abertos:", await page.locator("[role=dialog]").count().catch(() => "?"),
      "| aria-hidden:", await page.locator("body > [aria-hidden=true]").count().catch(() => "?"));
    console.error("  diag:", await page.evaluate(() => [...document.querySelectorAll("[role=dialog]")].map((d) => {
      const r = d.getBoundingClientRect();
      let hid = []; for (let e = d; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || e.getAttribute("aria-hidden") === "true") hid.push(e.tagName + "." + String(e.className).slice(0, 20) + ":" + cs.display + "/" + e.getAttribute("aria-hidden")); }
      return { title: d.querySelector("h2")?.textContent, rect: [r.x, r.y, r.width, r.height], hid };
    })).catch((e) => String(e)));
    throw e;
  }
}

let page;
// No Chromium de container a checagem de "estabilidade" do Playwright às vezes nunca conclui;
// o clique forçado mantém a verificação semântica (papel + nome acessível) do alvo.
const CLICK = process.env.E2E_FORCE_CLICK ? { force: true } : {};
const pageErrors = [];
const pending = new Map();
const watch = (p) => {
  p.on("request", (r) => pending.set(r, Date.now()));
  p.on("requestfinished", (r) => pending.delete(r));
  p.on("requestfailed", (r) => pending.delete(r));
  p.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));
  p.on("console", (m) => m.type() === "error" && pageErrors.push(m.text().split("\n")[0]));
};
// O Next.js pode manter a tela anterior oculta no DOM: sempre ler o que está visível
const text = async (sel) => (await page.locator(`${sel}:visible`).first().innerText()).replace(/\s+/g, " ");
const toast = async (re) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout: 10_000 });
/** Repete a verificação até passar (a tela atualiza após o servidor confirmar). */
async function eventually(fn, timeout = 10_000) {
  const start = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await page.waitForTimeout(250);
    }
  }
}
const stat = async (label) => {
  const card = page.locator("section[aria-label=Indicadores]:visible > div").filter({ hasText: label }).first();
  return (await card.innerText()).replace(/\s+/g, " ");
};

let ctx;
const CONTEXT_OPTS = { locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 1360, height: 900 } };

async function go(path) {
  for (let attempt = 1; ; attempt++) {
    const ok = await page
      .goto(`${URL}${path}`, { timeout: 20_000 })
      .then(() => page.waitForSelector("html[data-hydrated]", { state: "attached", timeout: 15_000 }))
      .then(() => true, () => false);
    if (ok) return;
    if (attempt === 2) throw new Error(`a página ${path} não carregou`);
    // Navegador headless travado em conexões antigas: recomeça com a mesma sessão (cookies)
    console.log(`  (recarregando contexto do navegador para ${path})`);
    const state = await ctx.storageState();
    await ctx.close().catch(() => {});
    ctx = await browser.newContext({ ...CONTEXT_OPTS, storageState: state });
    page = await ctx.newPage();
    watch(page);
  }
}

async function login() {
  await page.goto(`${URL}/login`);
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(CLICK);
  await page.waitForURL(`${URL}/`);
  await page.waitForSelector("html[data-hydrated]", { state: "attached" });
}

async function newEntry({ kind = "Despesa", amount, description, category, account, pending = false, from, to }) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Novo lançamento" }).first().click(CLICK);
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: kind, exact: true }).click(CLICK);
  await dlg.locator("#amount").fill(amount);
  if (description) await dlg.getByLabel("Descrição").fill(description);
  if (category) await dlg.getByRole("radio", { name: category, exact: true }).click(CLICK);
  if (account) await dlg.getByLabel("Conta", { exact: true }).selectOption({ label: account });
  if (from) await dlg.getByLabel("Sai de").selectOption({ label: from });
  if (to) await dlg.getByLabel("Entra em").selectOption({ label: to });
  if (pending) await dlg.getByRole("radio", { name: /A pagar|A receber|Agendada/ }).click(CLICK);
  await dlg.getByRole("button", { name: /Salvar lançamento/ }).click(CLICK);
  await dlg.waitFor({ state: "detached" });
}

ctx = await browser.newContext(CONTEXT_OPTS);
page = await ctx.newPage();
watch(page);

try {
  await step("1. Rotas protegidas redirecionam para o login", async () => {
    await page.goto(`${URL}/contas`);
    await page.waitForURL(/\/login$/);
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha").fill("senha-errada");
    await page.getByRole("button", { name: "Entrar" }).click(CLICK);
    await page.getByText("E-mail ou senha inválidos.").waitFor();
  });

  await step("1. Entrar com login", login);
  await page.screenshot({ path: `${SHOTS}/01-boas-vindas.png` });

  await step("2. Cadastrar contas e saldos iniciais", async () => {
    await page.getByRole("link", { name: "Cadastrar primeira conta" }).click(CLICK);
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Nome").fill("Nubank");
    await dlg.getByLabel("Tipo").selectOption("digital");
    await dlg.getByLabel("Saldo inicial (R$)").fill("1.500,00");
    await dlg.getByLabel("Na data").fill("2026-10-01");
    await dlg.getByRole("button", { name: "Criar conta" }).click(CLICK);
    await toast(/Conta criada/);
    await dlg.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Nova conta" }).click(CLICK);
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Nome").fill("Poupança");
    await dlg.getByLabel("Tipo").selectOption("savings");
    await dlg.getByLabel("Saldo inicial (R$)").fill("5000");
    await dlg.getByLabel("Na data").fill("2026-10-01");
    await dlg.getByRole("button", { name: "Criar conta" }).click(CLICK);
    await dlg.waitFor({ state: "detached" });
    await page.getByText("R$ 5.000,00").first().waitFor();
    await eventually(async () => assert.match(await text("main"), /Total em contas R\$ 6\.500,00/));
  });

  await step("3. Registrar uma receita", async () => {
    await newEntry({ kind: "Receita", amount: "4.000,00", description: "Salário outubro", category: "Salário", account: "Nubank" });
    await toast(/Receita registrada/);
  });

  await step("4. Registrar despesas (efetivada e pendente)", async () => {
    await newEntry({ amount: "85", description: "Gasolina", category: "Transporte", account: "Nubank" });
    await toast(/Despesa registrada/);
    await newEntry({ amount: "300,00", description: "Conta de luz", category: "Contas da casa", account: "Nubank", pending: true });
  });

  await step("5. Transferir dinheiro entre contas", async () => {
    await newEntry({ kind: "Transferência", amount: "500", from: "Nubank", to: "Poupança" });
    await toast(/Transferência registrada/);
    await go("/contas");
    // Nubank: 1500 + 4000 − 85 − 500 = 4.915 (a pendente de 300 não altera o saldo)
    await eventually(async () => assert.match(await text("main"), /Nubank.*R\$ 4\.915,00/));
    await eventually(async () => assert.match(await text("main"), /Poupança.*R\$ 5\.500,00/));
    await eventually(async () => assert.match(await text("main"), /Total em contas R\$ 10\.415,00/));
  });

  await step("6. Criar uma reserva financeira", async () => {
    await go("/reservas");
    await page.getByRole("button", { name: "Nova reserva" }).first().click(CLICK);
    const dlg = page.getByRole("dialog");
    await dlg.waitFor();
    await dlg.locator("#g-kind").selectOption("emergency");
    await dlg.getByLabel("Meta (R$)").fill("20.000,00");
    await dlg.getByLabel("Prazo (opcional)").fill("2027-09-15");
    await dlg.getByRole("button", { name: "Criar reserva" }).click(CLICK);
    await toast(/Reserva criada/);
  });

  await step("7. Registrar aporte (e bloquear aporte acima do saldo livre)", async () => {
    await page.getByRole("button", { name: "Aportar" }).click(CLICK);
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Dinheiro guardado na conta").selectOption({ label: "Poupança" });
    await dlg.getByLabel("Valor (R$)").fill("6000");
    await dlg.getByRole("button", { name: "Registrar aporte" }).click(CLICK);
    await toast(/Saldo livre insuficiente/);
    await dlg.getByLabel("Valor (R$)").fill("3.000");
    await dlg.getByRole("button", { name: "Registrar aporte" }).click(CLICK);
    await toast(/Aporte registrado/);
    await dlg.waitFor({ state: "detached" });
    await eventually(async () => assert.match(await text("main"), /Total reservado R\$ 3\.000,00/));
    await eventually(async () => assert.match(await text("main"), /15%/));
    // faltam 17.000 em 12 meses (out/26 → set/27) = 1.416,67/mês
    await eventually(async () => assert.match(await text("main"), /R\$ 1\.416,67\/mês/));
  });
  await page.screenshot({ path: `${SHOTS}/07-reservas.png`, fullPage: true });

  await step("8. Dashboard sem dupla contagem (competência)", async () => {
    await go("/");
    assert.match(await stat("Saldo disponível"), /R\$ 4\.915,00/); // só a conta operacional
    await eventually(async () => assert.match(await stat("Receitas"), /R\$ 4\.000,00/));
    assert.match(await stat("Despesas do mês"), /R\$ 385,00/); // 85 + 300 pendente
    await eventually(async () => assert.match(await stat("Resultado mensal"), /R\$ 3\.615,00/));
    await eventually(async () => assert.match(await stat("Reservas financeiras"), /R\$ 3\.000,00/));
    assert.match(await stat("Patrimônio líquido"), /R\$ 10\.415,00/); // NÃO 13.415
    assert.match(await text("main"), /Conta de luz/); // próximos vencimentos
  });
  await page.screenshot({ path: `${SHOTS}/08-dashboard.png`, fullPage: true });

  await step("8. Dashboard na visão de caixa", async () => {
    await page.getByRole("link", { name: "Caixa" }).click(CLICK);
    await page.waitForURL(/r=caixa/);
    await eventually(async () => assert.match(await stat("Despesas do mês"), /R\$ 85,00/));
    await eventually(async () => assert.match(await stat("Resultado mensal"), /R\$ 3\.915,00/));
  });

  await step("Marcar como pago, editar, duplicar, estornar e excluir", async () => {
    await go("/movimentacoes");
    const row = (name) => page.locator("li").filter({ hasText: name }).first();
    await row("Conta de luz").getByRole("button", { name: /Ações/ }).click(CLICK);
    await page.getByRole("menuitem", { name: "Marcar como pago" }).click(CLICK);
    await toast(/efetivado/);
    await row("Gasolina").getByRole("button", { name: /Ações/ }).click(CLICK);
    await page.getByRole("menuitem", { name: "Editar" }).click(CLICK);
    await page.getByRole("dialog").locator("#amount").fill("90,00");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar alterações" }).click(CLICK);
    await toast(/Lançamento atualizado/);
    await row("Gasolina").getByRole("button", { name: /Ações/ }).click(CLICK);
    await page.getByRole("menuitem", { name: "Duplicar" }).click(CLICK);
    await page.getByRole("dialog").getByRole("button", { name: /Salvar lançamento/ }).click(CLICK);
    await toast(/Despesa registrada/);
    await eventually(async () => assert.equal(await page.locator("li").filter({ hasText: "Gasolina" }).count(), 2));
    await row("Gasolina").getByRole("button", { name: /Ações/ }).click(CLICK);
    await page.getByRole("menuitem", { name: "Registrar estorno" }).click(CLICK);
    await page.getByRole("dialog").getByLabel("Valor estornado").fill("20");
    await page.getByRole("dialog").getByRole("button", { name: "Confirmar estorno" }).click(CLICK);
    await toast(/Estorno registrado/);
    await page.locator("li").filter({ hasText: "Gasolina" }).last().getByRole("button", { name: /Ações/ }).click(CLICK);
    await page.getByRole("menuitem", { name: "Excluir" }).click(CLICK);
    await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click(CLICK);
    await toast(/excluído|estornos/);
    await go("/contas");
    // Nubank: 1500 + 4000 − 90 (cópia) + 20 (estorno) − 300 (luz, agora paga) − 500 (transferência);
    // a gasolina original foi excluída
    await eventually(async () => assert.match(await text("main"), /Nubank.*R\$ 4\.630,00/));
  });

  await step("9. Navegar entre meses", async () => {
    await go("/");
    await page.getByRole("link", { name: "Mês anterior" }).click(CLICK);
    await page.waitForURL(/m=2026-09|m=\d{4}-\d{2}/);
    await eventually(async () => assert.match(await stat("Despesas do mês"), /R\$ 0,00/));
    // em 30/09 as contas ainda não tinham saldo inicial
    await eventually(async () => assert.match(await stat("Patrimônio líquido"), /R\$ 0,00/));
    await page.getByRole("link", { name: "Próximo mês" }).click(CLICK);
    await page.waitForURL((u) => !u.search.includes("m=2026-09"));
  });

  await step("Exportação de dados", async () => {
    const res = await page.request.get(`${URL}/api/export?formato=csv`);
    await eventually(async () => assert.equal(res.status(), 200));
    const body = await res.text();
    await eventually(async () => assert.match(body, /Salário outubro/));
    await eventually(async () => assert.match(body, /Transferência/));
  });

  await step("10. Sair, fechar o navegador, voltar e encontrar os dados", async () => {
    await go("/configuracoes");
    await page.getByRole("button", { name: "Sair desta sessão" }).click(CLICK);
    await page.waitForURL(/\/login$/);
    await ctx.close();
    ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page = await ctx.newPage();
    watch(page);
    await login();
    await eventually(async () => assert.match(await stat("Reservas financeiras"), /R\$ 3\.000,00/));
    await eventually(async () => assert.match(await text("main"), /Salário outubro|Gasolina/));
    await page.screenshot({ path: `${SHOTS}/10-celular-dashboard.png`, fullPage: true });
    await page.getByRole("button", { name: "Novo lançamento" }).click(CLICK);
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `${SHOTS}/10-celular-lancamento.png` });
  });
} finally {
  await browser.close();
  const failed = results.filter(([s]) => s === "✘").length;
  console.log(`\n${results.length - failed}/${results.length} etapas aprovadas`);
  process.exitCode = failed ? 1 : 0;
}
