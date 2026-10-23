/**
 * Teste de ponta a ponta da Fase 3: lançamento por frase, importação de CSV
 * (com duplicado e linha de saldo), relatórios, projeção negativa, insights,
 * exportação CSV por período e layout no celular.
 *
 *   E2E_URL=... E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/fase3.mjs
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
    await page.screenshot({ path: `${SHOTS}/fase3-falha-${results.length}.png`, fullPage: true }).catch(() => {});
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
const LAST_MONTH = addMonths(TODAY, -1);
/** Envia o arquivo; repete se o componente ainda não tinha hidratado. */
async function upload(name, content) {
  for (let i = 0; i < 4; i++) {
    await page.locator("#csv-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") });
    const ok = await page.getByText(/selecionadas/).first().waitFor({ timeout: 4_000 }).then(() => true, () => false);
    if (ok) return;
  }
  throw new Error("o arquivo não foi lido");
}
const br = (iso) => iso.split("-").reverse().join("/");

try {
  await step("Login", async () => {
    await page.goto(`${URL}/login`);
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click(CLICK);
    await page.waitForURL(`${URL}/`);
  });

  await step("Conta corrente com R$ 1.000 no início do mês passado", async () => {
    await go("/contas?nova=1");
    await dialog().getByLabel("Nome").fill("Corrente");
    await dialog().getByLabel("Saldo inicial (R$)").fill("1.000,00");
    await dialog().getByLabel("Na data").fill(`${LAST_MONTH}-01`);
    await dialog().getByRole("button", { name: "Criar conta" }).click(CLICK);
    await toast(/Conta criada/);
  });

  await step("Frase \"gastei 85 de gasolina hoje\" preenche o formulário e só salva ao confirmar", async () => {
    await go("/");
    await page.getByLabel("Lançamento rápido por frase").fill("gastei 85 de gasolina hoje");
    await page.getByRole("button", { name: "Interpretar e conferir" }).click(CLICK);
    await dialog().waitFor();
    await eventually(async () => {
      assert.equal(await dialog().locator("#amount").inputValue(), "85,00");
      assert.match(await text("[role=dialog]"), /Entendi:/);
      assert.equal(await dialog().getByRole("radio", { name: "Transporte", exact: true }).getAttribute("aria-checked"), "true");
    });
    await dialog().getByRole("button", { name: "Salvar lançamento" }).click(CLICK);
    await toast(/Despesa registrada/);
  });

  await step("Importar extrato CSV: sugere categorias, marca duplicado e ignora linha de saldo", async () => {
    await go("/importar");
    const csv = [
      "Data;Histórico;Valor",
      `${br(LAST_MONTH + "-05")};SALARIO EMPRESA XYZ;3.000,00`,
      `${br(LAST_MONTH + "-10")};PIX ENVIADO SUPERMERCADO BOM PRECO;-400,00`,
      `${br(LAST_MONTH + "-12")};POSTO SHELL 123;-150,00`,
      `${br(LAST_MONTH + "-12")};SALDO DO DIA;3.450,00`,
      `${br(TODAY)};Gasolina;-85,00`,
    ].join("\r\n");
    await page.locator("#csv-file").setInputFiles({ name: "extrato.csv", mimeType: "text/csv", buffer: Buffer.from("﻿" + csv, "utf8") });
    await eventually(async () => {
      const t = await text();
      assert.match(t, /3 de 5 selecionadas/);
      assert.match(t, /1 já existem/);
      assert.match(t, /linha de saldo/);
    });
    const rows = page.locator("[data-testid=import-rows] > li");
    const catOf = async (desc) => {
      const sel = rows.filter({ hasText: desc }).first().locator("select");
      return sel.evaluate((s) => s.options[s.selectedIndex].text);
    };
    assert.equal(await catOf("SALARIO"), "Salário");
    assert.equal(await catOf("POSTO SHELL"), "Transporte");
    await page.screenshot({ path: `${SHOTS}/fase3-importar.png`, fullPage: true });
    await page.getByRole("button", { name: /Importar 3 lançamentos/ }).click(CLICK);
    await toast(/3 lançamentos importados/);
    await page.getByRole("link", { name: "Ver movimentações" }).waitFor();
  });

  await step("Importados aparecem nas movimentações do mês passado", async () => {
    await go(`/movimentacoes?m=${LAST_MONTH}`);
    await eventually(async () => {
      const t = await text();
      assert.match(t, /SALARIO EMPRESA XYZ/);
      assert.match(t, /POSTO SHELL 123/);
      assert.doesNotMatch(t, /SALDO DO DIA/);
    });
  });

  await step("Reimportar o mesmo arquivo marca tudo como já existente", async () => {
    await go("/importar");
    const csv = `Data;Histórico;Valor\r\n${br(LAST_MONTH + "-12")};POSTO SHELL 123;-150,00`;
    await upload("de-novo.csv", csv);
    await eventually(async () => assert.match(await text(), /0 de 1 selecionadas · 1 já existem/));
  });

  await step("Conta a pagar grande gera projeção negativa e alerta", async () => {
    await go("/");
    await page.getByLabel("Lançamento rápido por frase").fill("aluguel 9.000 a pagar amanhã");
    await page.getByRole("button", { name: "Interpretar e conferir" }).click(CLICK);
    await dialog().waitFor();
    await eventually(async () => assert.equal(await dialog().locator("#amount").inputValue(), "9.000,00"));
    await dialog().getByRole("button", { name: "Salvar lançamento" }).click(CLICK);
    await toast(/Despesa registrada/);
  });

  await step("Relatórios: KPIs, comparação, fixas × variáveis, projeção e insights", async () => {
    await go("/relatorios");
    await eventually(async () => {
      const t = await text();
      assert.match(t, /Receitas R\$ 3\.000,00/);
      assert.match(t, /Comparação de meses/);
      assert.match(t, /Fixas × variáveis/);
      assert.match(t, /Projeção do saldo disponível/);
      assert.match(t, /O saldo disponível fica negativo em \d{2}\/\d{2}\/\d{4}/);
      assert.match(t, /fica negativo em/); // insight da projeção
      assert.match(t, /Patrimônio líquido/);
    });
    await page.screenshot({ path: `${SHOTS}/fase3-relatorios.png`, fullPage: true });
    await go(`/relatorios?m=${LAST_MONTH}&p=3`);
    await eventually(async () => assert.match(await text(), /economizou \d+% da sua receita/));
  });

  await step("CSV do período exporta só o intervalo pedido", async () => {
    await go(`/relatorios?m=${LAST_MONTH}&p=3`);
    const href = await page.getByRole("link", { name: /CSV do período/ }).getAttribute("href");
    assert.match(href, /de=\d{4}-\d{2}-01&ate=\d{4}-\d{2}-\d{2}/);
    const res = await page.request.get(`${URL}${href}`);
    const body = await res.text();
    assert.match(body, /POSTO SHELL 123/);
    assert.doesNotMatch(body, /aluguel/i); // é deste mês, fora do período
  });

  await step("Dashboard mostra os insights do mês", async () => {
    await go("/");
    await eventually(async () => assert.match(await text(), /Insights do mês/));
  });

  await step("Celular: relatórios e importação sem rolagem lateral", async () => {
    const state = await ctx.storageState();
    const m = await browser.newContext({ ...CONTEXT_OPTS, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: state });
    const p = await m.newPage();
    for (const path of ["/relatorios", "/importar", "/"]) {
      await p.goto(`${URL}${path}`);
      await p.waitForSelector("html[data-hydrated]", { state: "attached", timeout: 15_000 });
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${path} rola ${over}px para o lado`);
    }
    await p.goto(`${URL}/relatorios`);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${SHOTS}/fase3-relatorios-celular.png`, fullPage: true });
    await m.close();
  });
} finally {
  console.log(`\n${results.filter((r) => r[0] === "✔").length}/${results.length} etapas ok`);
  await browser.close();
}
if (results.some((r) => r[0] === "✘")) process.exit(1);
