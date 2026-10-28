# Meu Financeiro

Gerenciador de finanças pessoais — privado, de um único usuário, feito para registrar um gasto em poucos segundos e acompanhar contas, reservas e patrimônio por anos.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · componentes no padrão shadcn/ui (Radix) · Lucide · Recharts · Supabase (Postgres + Auth + RLS) · React Hook Form · Zod · date-fns · Vitest.

![Dashboard no modo escuro](docs/screenshots/dashboard-escuro.png)

---

## Status: Fase 1 (MVP) concluída

| Critério de entrega (seção 19) | Status |
|---|---|
| 1. Entrar com login | ✅ |
| 2. Cadastrar contas e saldos iniciais | ✅ |
| 3. Registrar uma receita | ✅ |
| 4. Registrar uma despesa | ✅ |
| 5. Transferir dinheiro entre contas | ✅ |
| 6. Criar uma reserva financeira | ✅ |
| 7. Registrar um aporte nessa reserva | ✅ |
| 8. Consultar o dashboard | ✅ |
| 9. Navegar entre meses | ✅ |
| 10. Fechar o navegador, voltar e encontrar os dados | ✅ |

Os 10 critérios foram validados por um teste automatizado de ponta a ponta (`tests/e2e/acceptance.mjs`) rodando o app real contra **Supabase Auth (GoTrue) + PostgREST + PostgreSQL 16 reais**, além do celular (390 px).

**Também entregue:**

- Lançamentos: editar, excluir, duplicar, pesquisar, filtrar, marcar como pago/recebido, cancelar e registrar estorno.
- Conciliação de saldo com justificativa e histórico.
- Regime **competência × caixa** no dashboard e nos relatórios.
- Relatório de histórico mensal (12 meses, taxa de poupança, média de despesas).
- Visão de contas a pagar e a receber em 7, 15 e 30 dias.
- Exportação JSON (backup completo) e CSV, mais um script de restauração testado.
- Modo claro/escuro, layout responsivo com navegação inferior no celular e atalho **N** para novo lançamento.

## Fase 2 — Controle avançado (concluída)

- **Cartões de crédito**: limite, fechamento e vencimento; compras à vista ou parceladas (até 72x) com prévia das parcelas; faturas navegáveis mês a mês; pagamento total ou parcial; estornos; tarifas, juros e créditos.
- **Recorrências**: qualquer receita ou despesa pode repetir (semanal a anual, com data final opcional), inclusive assinaturas no cartão. Editar só esta, esta e as próximas, ou encerrar.
- **Orçamentos** mensais por categoria, com avisos em 80% e 100% e cópia para o mês seguinte.
- **Vencimentos** em 7, 15 e 30 dias, incluindo faturas de cartão.
- Dashboard e relatórios passam a considerar o cartão sem dupla contagem; o patrimônio desconta a dívida dos cartões.

## Fase 3 — Inteligência e relatórios (concluída)

- **Relatórios** com período (3, 6, 12 ou 24 meses) e mês de referência: receitas × despesas, gastos por categoria, comparação mês a mês por categoria, fixas × variáveis, taxa de poupança, despesa média mensal, evolução do patrimônio, das reservas e da dívida de cartão.
- **Projeção do saldo disponível** dia a dia até o fim do mês seguinte (contas a pagar/receber e faturas em aberto), com alerta do primeiro dia negativo.
- **Insights por regras**, só com base em dados existentes (sem histórico, o app diz que ainda não há base). O mês em andamento é comparado com os mesmos dias do mês anterior.
- **Lançamento por frase** ("gastei 85 de gasolina hoje", "notebook 3.600 em 6x no nubank"): interpretação local, sem IA externa; o formulário sempre abre preenchido para você conferir e salvar.
- **Importação de CSV** (extrato, fatura de cartão ou o próprio CSV do app): separador `;` ou `,`, datas e valores BR ou internacionais, colunas de crédito/débito ou D/C, categoria sugerida pelo histórico e por palavras-chave, duplicados marcados, linhas de saldo e pagamentos de fatura ignorados. Até 1.000 linhas por vez.
- **Exportação CSV por período** (`/api/export?formato=csv&de=AAAA-MM-DD&ate=AAAA-MM-DD`), com botão na página de relatórios.
- **Celular**: barra de lançamento rápido no início, atalhos do app instalado (Novo lançamento, Movimentações, Planejamento), importação no menu "Mais".

A integração com Telegram/WhatsApp ficou para depois.

### Notificações no celular

Todo dia às **9h (Brasília)** o app manda notificações para os aparelhos ativados em **Configurações → Notificações no celular**:

- fatura que **vence amanhã** (com o valor, a conta que paga e, se o saldo não cobrir, quanto falta e de onde dá para transferir);
- **saldo que não cobre** o que sai de uma conta nos próximos 3 dias (faturas e contas a pagar, contando as receitas previstas);
- **contas a pagar** que vencem amanhã;
- **receita prevista** para hoje (e lembrete 2 dias depois, se não foi marcada como recebida);
- **fatura vencida** sem pagamento registrado (dia seguinte e 3 dias depois).

Os mesmos avisos aparecem no card **Avisos** do início. No iPhone, as notificações exigem o app adicionado à Tela de Início (iOS 16.4+).

Como funciona: `pg_cron` chama às 12h UTC a Edge Function `supabase/functions/alerts` (Web Push com chaves VAPID geradas e guardadas no próprio banco, em `private.app_config`). As regras ficam em `src/lib/finance/alerts.ts`; a função usa uma cópia idêntica (um teste garante que as duas não divergem). Para publicar a função depois de mudar as regras: copie o arquivo para `supabase/functions/alerts/alerts.ts` e rode `supabase functions deploy alerts --no-verify-jwt`.

---

## Colocar no ar (≈ 15 minutos)

### 1. Criar o projeto no Supabase

1. Crie um projeto em [supabase.com](https://supabase.com). Para os dados ficarem perto de você, escolha a região de São Paulo.
2. **Aplique as migrações, em ordem.** Abra o **SQL Editor** e execute cada arquivo de `supabase/migrations/` (Fase 1, depois Fase 2).
   - Alternativa com a CLI: `npx supabase link --project-ref <ref>` e depois `npx supabase db push`.
3. **Desative cadastros públicos.** Em *Authentication*, nas configurações de cadastro, desligue a opção que permite novos usuários se cadastrarem. Este app não tem tela de cadastro, mas a API de cadastro do Supabase continua aberta se você não desligar.
4. **Crie o seu usuário.** Em *Authentication → Users → Add user*, use e-mail e senha forte e marque a confirmação automática.

### 2. Rodar localmente

```bash
cp .env.example .env.local   # preencha a URL e a chave pública (publishable/anon) do projeto
npm install
npm run dev                  # http://localhost:3000
```

Só a **chave pública** vai para o app. A chave secreta (service role) **nunca** é usada pelo app. Ela serve apenas para o script de restauração, executado na sua máquina.

### 3. Publicar (Vercel)

1. Suba o código para um repositório privado no GitHub e importe o projeto na Vercel.
2. Configure as variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ou `NEXT_PUBLIC_SUPABASE_ANON_KEY` em projetos antigos).
3. No Supabase, em *Authentication → URL Configuration*, coloque a URL da Vercel como *Site URL*.

No primeiro acesso, as categorias padrão são criadas automaticamente. Depois cadastre suas contas com o saldo de hoje.

---

## Regras financeiras

O documento completo, com exemplos, está em [`docs/regras-financeiras.md`](docs/regras-financeiras.md). Em resumo:

- **Saldo** = saldo inicial + movimentações **efetivadas**. Ele nunca é armazenado, sempre recalculado.
- **Pendente não altera saldo.** **Transferência não é receita nem despesa.**
- **Competência** usa a data do lançamento, incluindo pendentes. **Caixa** usa a data em que foi efetivamente pago.
- **Estorno** abate a despesa original, na mesma categoria.
- **Reserva é uma etiqueta sobre o saldo de uma conta**, não dinheiro novo:
  - Disponível = contas operacionais − reservado.
  - Patrimônio = contas − dívidas. As reservas já estão dentro dos saldos e nunca são somadas duas vezes.

---

## Segurança

- **Row Level Security** em todas as tabelas, com política `user_id = auth.uid()`. O papel anônimo não tem acesso a nada.
- **Integridade por dono no banco.** FKs compostas `(id, user_id)` impedem que um lançamento aponte para a conta de outro usuário, mesmo que alguém burle a interface.
- **Regras críticas no próprio Postgres**, por CHECKs e triggers, valendo para qualquer cliente:
  - estorno ≤ despesa original;
  - aporte ≤ saldo livre;
  - reserva nunca negativa;
  - categoria compatível com o tipo do lançamento;
  - `pago` ⇔ data de pagamento preenchida.
- **Validação dupla.** Toda gravação passa por Server Actions validadas com Zod no servidor, e a sessão é verificada no servidor do Supabase (`getUser`).
- **Proteção de rotas.** O proxy (`src/proxy.ts`) renova a sessão e redireciona quem não está logado. A API de exportação responde 401 sem sessão.
- **Cabeçalhos de segurança:** `X-Frame-Options: DENY`, `nosniff`, HSTS e `Referrer-Policy`.
- **CSV protegido** contra injeção de fórmulas. Nenhuma senha bancária é armazenada.

## Backup e recuperação

1. **Backup:** em *Configurações → Exportar dados → Backup completo (JSON)*. Faça uma vez por mês e guarde em local seguro.
   - Verifique também, no painel do Supabase, que backups automáticos o seu plano inclui.
   - Para um dump SQL completo: `npx supabase db dump --data-only > backup.sql`.
2. **Restaurar** (projeto novo ou após perda de dados):
   1. Aplique a migração no projeto de destino.
   2. Crie o usuário e copie o ID dele em *Authentication → Users*.
   3. Rode, na sua máquina:

      ```bash
      SUPABASE_URL=https://xxx.supabase.co \
      SUPABASE_SERVICE_ROLE_KEY=... \
      RESTORE_USER_ID=<id do usuário> \
      node scripts/restore-backup.mjs meu-financeiro-backup-AAAA-MM-DD.json
      ```

   O procedimento foi testado: exportar, apagar tudo e restaurar resultou em saldos e reservas idênticos.

---

## Testes

```bash
npm test            # unitários + banco (127 testes)
npm run typecheck
npm run build
```

| Suíte | O que cobre |
|---|---|
| `tests/unit` (36) | Centavos e parsing de "1.234,56"; datas no fuso de São Paulo, meses e anos bissextos; competência × caixa; estornos; nenhum lançamento contado em dois meses; disponível, reservas e patrimônio sem dupla contagem; progresso e aporte sugerido. |
| `tests/db` (21) | **As mesmas migrações de produção** num Postgres embarcado (PGlite): saldos, pendentes, data de pagamento, saldo inicial, edição e exclusão, transferências, constraints, estornos, conciliação, regras de reserva e **isolamento entre usuários via RLS**. |
| `tests/e2e` (14 etapas) | Os 10 critérios de entrega no navegador, mais editar, duplicar, estornar, excluir, regime de caixa, exportação e uso no celular. |
| `tests/unit/fase2` (13) | Faturas (fechamento/vencimento, virada de ano, dia 31), divisão de parcelas, situação da fatura, cartão em competência × caixa, orçamentos. |
| `tests/db/fase2` (26) | **Atualizar Fase 1 → Fase 2 não altera saldos nem dados**; parcelas e faturas; estornos; pagamento parcial; recorrências (idempotência, exclusão não volta, encerrar, "esta e as próximas"); orçamentos; isolamento por usuário. |
| `tests/unit/quick-parse`, `fase3`, `csv-import` (31) | Frases → valor, data, categoria, conta/cartão, parcelas; relatórios, projeção de saldo, insights sem inventar conclusões; leitura de CSV, formatos de data/valor de bancos, duplicados e sugestão de categoria. |
| `tests/e2e/fase3.mjs` (11 etapas) | Frase → formulário, importação com duplicado e linha de saldo, reimportação, projeção negativa, relatórios, insights, CSV do período, celular sem rolagem lateral. |
| `tests/e2e/fase2.mjs` (12 etapas) | Cartão, compra 6x, fatura, pagamento parcial, estorno, recorrência e edição da série, orçamento com aviso de 80%, celular sem rolagem lateral. |

O teste de ponta a ponta precisa de um usuário **sem dados**, num projeto Supabase **de testes, nunca o de produção**:

```bash
npx playwright install chromium
E2E_URL=http://localhost:3000 E2E_EMAIL=teste@exemplo.com E2E_PASSWORD=... npm run test:e2e
```

---

## Estrutura

```
supabase/migrations/   schema, RLS, triggers e função de saldos (versionado)
src/lib/finance/       regras financeiras puras e testáveis (dinheiro, datas, resumos, reservas)
src/lib/data/          consultas ao Supabase (somente servidor, paginadas)
src/lib/actions/       Server Actions (validação Zod + gravação)
src/lib/validation.ts  schemas compartilhados entre formulário e servidor
src/app/(app)/         telas: dashboard, movimentações, contas, reservas, planejamento, relatórios, configurações
src/components/        UI (shadcn-style), shell/navegação, formulários de lançamento, gráficos
docs/                  regras financeiras e capturas de tela
scripts/               restauração de backup
tests/                 unit, db (Postgres embarcado) e e2e
```
