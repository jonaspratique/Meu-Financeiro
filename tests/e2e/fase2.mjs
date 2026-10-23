/**
 * Teste de ponta a ponta da Fase 2: cartão parcelado, fatura, pagamento parcial,
 * estorno, recorrência (editar "este e os próximos") e orçamento com aviso de 80%.
 *
 *   E2E_URL=... E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/fase2.mjs
 *
 * O usuário de teste deve começar SEM dados. Usa a data de hoje do navegador.
 * Variáveis opcionais: E2E_CHROMIUM, E2E_CHROMIUM_ARGS, E2E_FORCE_CLICK, E2E_SHOTS.
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const URL = process.env.E2E_URL ?? "http://localhost:3000";
const { E2E_EMAIL: EMAIL, E2E_PASSWORD: PASSWORD } = process.env;
const SHOTS = process.env.E2E_SHOTS ?? "tests/e2e/screenshots";
const CLICK = process.env.E2E_FORCE_CLICK ? { force: true } : {};
mkdirSync(SHOTS, { recursive: true });
if (!EMAIL || !PASSWORD) throw new Error("Defina E2E_EMAIL e E2E_PASSWORD");

const browser = await chromium.launch({
  executablePath: process.env.E2E_CHROMIUM || undefined,
  args: process.env.E2E_CHROMIUM_ARGS ? JSON.parse(process.env.E2E_CHROMIUM_ARGS) : [],
  headless: true,
});
const CONTEXT_OPTS = { locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 1360, height: 900 } };
let ctx = await browser.newContext(CONTEXT_OPTS);
let page = await ctx.newPage();

/* ------------------------------- utilitários ------------------------------- */
const pad = (n) => String(n).padStart(2, "0");
const sp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const TODAY = sp.format(new Date());
const addMonths = (iso, k) => {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const THIS_MONTH = TODAY.slice(0, 7);
const brl = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (cents) => new RegExp(esc(brl(cents)));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["✔", name]);
    console.log("✔", name);
  } catch (e) {
    results.push(["✘", name]);
    console.error("✘", name, "\n ", e.message.split("\n").slice(0, 6).join("\n  "));
    await page.screenshot({ path: `${SHOTS}/fase2-falha-${results.length}.png`, fullPage: true }).catch(() => {});
    throw e;
  }
}
async function eventually(fn, timeout = 12_000) {
  const start = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await page.waitForTimeout(300);
    }
  }
}
const text = async (sel = "main") => (await page.locator(`${sel}:visible`).first().innerText()).replace(/\s+/g, " ");
const toast = (re) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout: 12_000 });
const stat = async (label) =>
  (await page.locator("section[aria-label=Indicadores]:visible > div").filter({ hasText: label }).first().innerText()).replace(/\s+/g, " ");

async function go(path) {
  for (let attempt = 1; ; attempt++) {
    const ok = await page
      .goto(`${URL}${path}`, { timeout: 20_000 })
      .then(() => page.waitForSelector("html[data-hydrated]", { state: "attached", timeout: 15_000 }))
      .then(() => true, () => false);
    if (ok) return;
    if (attempt === 2) throw new Error(`a página ${path} não carregou`);
    const state = await ctx.storageState();
    await ctx.close().catch(() => {});
    ctx = await browser.newContext({ ...CONTEXT_OPTS, storageState: state });
    page = await ctx.newPage();
  }
}
const dialog = () => page.getByRole("dialog");
async function openNewEntry() {
  await page.getByRole("button", { name: "Novo lançamento" }).first().click(CLICK);
  await dialog().waitFor();
}
async function rowMenu(name, item) {
  await page.locator("li:visible").filter({ hasText: name }).first().getByRole("button", { name: /Ações/ }).click(CLICK);
  await page.getByRole("menuitem", { name: item }).click(CLICK);
}

/* --------------------------------- roteiro --------------------------------- */
try {
  await step("Login", async () => {
    await page.goto(`${URL}/login`);
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click(CLICK);
    await page.waitForURL(`${URL}/`);
  });

  await step("Conta corrente com saldo inicial", async () => {
    await go("/contas?nova=1");
    await dialog().getByLabel("Nome").fill("Corrente");
    await dialog().getByLabel("Saldo inicial (R$)").fill("5.000,00");
    await dialog().getByLabel("Na data").fill(`${THIS_MONTH}-01`);
    await dialog().getByRole("button", { name: "Criar conta" }).click(CLICK);
    await toast(/Conta criada/);
  });

  await step("Cadastrar cartão (fecha 5, vence 12, limite R$ 5.000)", async () => {
    await go("/contas");
    await page.getByRole("button", { name: "Novo cartão" }).click(CLICK);
    await dialog().getByLabel("Nome").fill("Nubank");
    await dialog().getByLabel("Limite (R$)").fill("5.000,00");
    await dialog().getByLabel("Dia do fechamento").fill("5");
    await dialog().getByLabel("Dia do vencimento").fill("12");
    await dialog().getByLabel("Conta que paga a fatura").selectOption({ label: "Corrente" });
    await dialog().getByRole("button", { name: "Criar cartão" }).click(CLICK);
    await toast(/Cartão criado/);
    await eventually(async () => assert.match(await text(), /Nubank.*Fecha dia 5 · vence dia 12/));
  });

  // compra hoje; com fechamento dia 5 a 1ª parcela cai na fatura de vencimento do mês seguinte (se hoje ≥ 5)
  const firstStatement = Number(TODAY.slice(8, 10)) >= 5 ? addMonths(TODAY, 1) : THIS_MONTH;

  await step("Compra de R$ 1.200 em 6x no cartão, com prévia das parcelas", async () => {
    await openNewEntry();
    await dialog().locator("#amount").fill("1.200,00");
    await dialog().getByLabel("Descrição").fill("Notebook");
    await dialog().getByRole("radio", { name: "Compras", exact: true }).click(CLICK);
    await dialog().getByLabel("Conta ou cartão").selectOption({ label: "Nubank" });
    await dialog().getByLabel("Parcelas").selectOption("6");
    await eventually(async () => assert.match(await text("[role=dialog]"), /6x de R\$ 200,00/));
    await dialog().getByRole("button", { name: "Salvar lançamento" }).click(CLICK);
    await toast(/Compra em 6x registrada/);
  });

  let cardUrl;
  await step("Fatura mostra a 1ª parcela e o limite usa o total", async () => {
    await go("/contas");
    const href = await page.getByRole("link", { name: "Nubank" }).first().getAttribute("href");
    cardUrl = href;
    await go(`${href}?m=${firstStatement}`);
    await eventually(async () => {
      const t = await text();
      assert.match(t, /Parcela 1\/6/);
      assert.match(t, /Notebook/);
      assert.match(t, /Limite usado R\$ 1\.200,00/);
      assert.match(t, /Disponível: R\$ 3\.800,00/);
    });
    await go(`${href}?m=${addMonths(`${firstStatement}-01`, 1)}`);
    await eventually(async () => assert.match(await text(), /Parcela 2\/6/));
    await page.screenshot({ path: `${SHOTS}/fase2-fatura.png`, fullPage: true });
  });

  await step("Pagamento parcial de R$ 150 reduz conta e dívida", async () => {
    await go(`${cardUrl}?m=${firstStatement}`);
    await page.getByRole("button", { name: "Pagar fatura" }).click(CLICK);
    await dialog().getByLabel("Valor pago (R$)").fill("150,00");
    await dialog().getByRole("button", { name: "Registrar pagamento" }).click(CLICK);
    await toast(/Pagamento de R\$ 150,00 registrado/);
    await eventually(async () => {
      const t = await text();
      assert.match(t, /Pagamento da fatura/);
      assert.match(t, /R\$ 50,00/); // saldo a pagar
    });
    await go("/contas");
    await eventually(async () => {
      const t = await text();
      assert.match(t, /Corrente.*R\$ 4\.850,00/);
      assert.match(t, /Dívida nos cartões R\$ 1\.050,00/);
    });
  });

  await step("Dashboard: competência conta a parcela; caixa conta o pagamento; patrimônio desconta a dívida", async () => {
    await go("/");
    await eventually(async () => {
      assert.match(await stat("Despesas do mês"), /R\$ 200,00/);
      assert.match(await stat("Saldo disponível"), /R\$ 4\.850,00/);
      assert.match(await stat("Patrimônio líquido"), /R\$ 3\.800,00/);
    });
    await go("/?r=caixa");
    await eventually(async () => assert.match(await stat("Despesas do mês"), /R\$ 150,00/));
    await eventually(async () => assert.match(await text(), /Fatura do cartão/));
  });

  await step("Estorno de R$ 100 vira crédito na fatura", async () => {
    await go(`${cardUrl}?m=${firstStatement}`);
    await rowMenu("Notebook", "Registrar estorno");
    await dialog().getByLabel("Valor estornado").fill("100,00");
    await dialog().getByRole("button", { name: "Confirmar estorno" }).click(CLICK);
    await toast(/Estorno lançado/);
    await eventually(async () => {
      const t = await text();
      assert.match(t, /Estorno: Notebook/);
      assert.match(t, /Crédito a favor/);
      assert.match(t, /Limite usado R\$ 950,00/);
    });
  });

  await step("Aluguel que se repete todo mês (previsto, não pago)", async () => {
    await go("/movimentacoes");
    await openNewEntry();
    await dialog().locator("#amount").fill("1.500,00");
    await dialog().getByLabel("Descrição").fill("Aluguel");
    await dialog().getByRole("radio", { name: "Moradia", exact: true }).click(CLICK);
    await dialog().getByLabel("Conta ou cartão").selectOption({ label: "Corrente" });
    await dialog().getByRole("radio", { name: "A pagar" }).click(CLICK);
    await dialog().getByRole("button", { name: /Repetir, observações/ }).click(CLICK);
    await dialog().getByLabel("Repetir").selectOption("monthly-1");
    await dialog().getByRole("button", { name: "Salvar lançamento" }).click(CLICK);
    await toast(/Lançamento recorrente criado/);
    await go(`/movimentacoes?m=${addMonths(TODAY, 1)}`);
    await eventually(async () => assert.match(await text(), /Aluguel.*-R\$ 1\.500,00.*A pagar/));
    await go("/planejamento");
    await eventually(async () => assert.match(await text(), /Aluguel Todo mês · Corrente · próxima/));
  });

  await step("Editar 'este e os próximos' muda só daqui em diante", async () => {
    const next = addMonths(TODAY, 1);
    await go(`/movimentacoes?m=${next}`);
    await rowMenu("Aluguel", "Editar");
    await dialog().getByRole("radio", { name: "Este e os próximos" }).click(CLICK);
    await dialog().locator("#amount").fill("1.650,00");
    await dialog().getByRole("button", { name: "Salvar alterações" }).click(CLICK);
    await toast(/próximas ocorrências foram atualizadas/);
    await eventually(async () => assert.match(await text(), /Aluguel.*-R\$ 1\.650,00/));
    await go("/movimentacoes");
    await eventually(async () => assert.match(await text(), /Aluguel.*-R\$ 1\.500,00/));
    // sem duplicatas no mês seguinte
    await go(`/movimentacoes?m=${next}`);
    await eventually(async () => assert.equal(await page.locator("li:visible").filter({ hasText: "Aluguel" }).count(), 1));
  });

  await step("Orçamento de Compras com aviso de 80%, e cópia para o mês seguinte", async () => {
    await go("/planejamento");
    await page.getByRole("button", { name: "Orçamento" }).click(CLICK);
    await dialog().getByLabel("Categoria").selectOption({ label: "Compras" });
    await dialog().getByLabel("Limite do mês (R$)").fill("120,00");
    await dialog().getByRole("button", { name: "Salvar orçamento" }).click(CLICK);
    await toast(/Orçamento salvo/);
    // gasto de Compras no mês = parcela 200 − estorno 100 = 100 → 83%
    await eventually(async () => assert.match(await text(), /Compras 83%/));
    await page.getByRole("button", { name: /Copiar para/ }).click(CLICK);
    await toast(/1 orçamento copiado/);
    await go("/");
    await eventually(async () => assert.match(await text(), /Acima de 80%: Compras \(83%\)/));
    await page.screenshot({ path: `${SHOTS}/fase2-dashboard.png`, fullPage: true });
  });

  await step("Faturas aparecem nos vencimentos e nada transborda no celular", async () => {
    await ctx.close();
    ctx = await browser.newContext({ ...CONTEXT_OPTS, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page = await ctx.newPage();
    await page.goto(`${URL}/login`);
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click(CLICK);
    await page.waitForURL(`${URL}/`);
    for (const path of ["/", "/planejamento", "/contas", cardUrl, "/movimentacoes"]) {
      await go(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${path} rola na horizontal (${overflow}px)`);
    }
    await go(cardUrl);
    await page.screenshot({ path: `${SHOTS}/fase2-celular-cartao.png`, fullPage: true });
    await go("/planejamento");
    await page.screenshot({ path: `${SHOTS}/fase2-celular-planejamento.png`, fullPage: true });
  });
} finally {
  await browser.close();
  const failed = results.filter(([s]) => s === "✘").length;
  console.log(`\n${results.length - failed}/${results.length} etapas aprovadas`);
  process.exitCode = failed ? 1 : 0;
}
