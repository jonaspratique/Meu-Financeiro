# Regras financeiras do Meu Financeiro

Este documento define cada conceito usado no sistema. Elas estão implementadas em dois lugares, cada um com uma responsabilidade:

| Onde | O quê |
|---|---|
| `supabase/migrations/…_fase1_schema.sql` → função `account_balances(data)` | **Estoques**: saldo de cada conta e quanto dele está reservado, em qualquer data. |
| `src/lib/finance/*.ts` | **Fluxos**: receitas, despesas e resultado de um período, nos dois regimes; reservas; indicadores. |

Valores monetários são sempre **inteiros em centavos** (`bigint` no banco, `number` inteiro no TypeScript). Nunca se soma float.

## Datas de um lançamento

Cada receita/despesa tem duas datas:

- **`date` — competência / vencimento**: quando o fato pertence (a compra, a conta de luz de outubro).
- **`paid_at` — caixa**: quando o dinheiro efetivamente saiu ou entrou. Só existe se o status for `paid`.

O banco garante: `status = 'paid'` ⇔ `paid_at` preenchido.

## Status

| Status | Altera saldo? | Entra em competência? | Entra em caixa? |
|---|---|---|---|
| `paid` (pago / recebido) | Sim, na data `paid_at` | Sim, na data `date` | Sim, na data `paid_at` |
| `pending` (a pagar / a receber) | **Não** | Sim | Não |
| `cancelled` | Não | Não | Não |

## Fluxo de caixa × resultado por competência

- **Competência** (padrão do dashboard): responde *"quanto eu gastei em outubro?"*. Soma lançamentos com `date` no mês, inclusive pendentes, exceto cancelados.
- **Caixa**: responde *"quanto dinheiro saiu em outubro?"*. Soma apenas efetivados com `paid_at` no mês.
- **Resultado mensal** = receitas − despesas, no regime escolhido.

Um mesmo lançamento nunca é contado em dois meses dentro do mesmo regime (há teste para isso).

## Saldo bancário

```
saldo(conta, data) = saldo inicial
                   + receitas e estornos efetivados
                   − despesas efetivadas
                   + transferências recebidas efetivadas
                   − transferências enviadas efetivadas
                   + ajustes de conciliação
   considerando apenas o que foi efetivado entre a data do saldo inicial e a data
```

- O saldo **nunca é armazenado**: é sempre recalculado, então não há como ficar inconsistente após edição, exclusão ou troca de datas.
- Lançamentos **anteriores à data do saldo inicial** ficam no histórico, mas não alteram o saldo (o saldo inicial já os reflete).
- Antes da data do saldo inicial, a conta não existe no cálculo.

## Transferências internas

Movem dinheiro entre duas contas suas. **Não são receita nem despesa** e nunca aparecem em resultado, gastos por categoria ou taxa de poupança. O patrimônio total não muda.

## Estornos, reembolsos e cancelamentos

- **Estorno/reembolso** (`type = 'refund'`): vinculado a uma despesa original, devolve o dinheiro na mesma conta e **abate a despesa da mesma categoria** (não vira "receita"). O banco impede estornar mais do que o valor original, estornar algo que não é despesa e cancelar/reduzir uma despesa que tem estornos.
- **Cancelamento**: um lançamento pendente pode ser cancelado (mantém o histórico) ou excluído.

## Ajustes de conciliação

Quando o saldo do banco difere do registrado, o usuário informa o saldo real e uma justificativa. O sistema grava um ajuste com a diferença e a "fotografia" do momento (saldo do sistema × saldo informado). Ajustes alteram o saldo, mas **não são receita nem despesa**.

## Reservas (saldo reservado)

Uma reserva **não é dinheiro novo**. Um aporte **etiqueta** parte do saldo de uma conta existente para um objetivo; uma retirada remove a etiqueta.

- O saldo da conta não muda com aporte ou retirada.
- Aporte não pode exceder o **saldo livre** (saldo − já reservado) da conta.
- O valor guardado de uma reserva em uma conta nunca fica negativo.
- Para guardar o dinheiro em outra conta (ex.: poupança), faça antes uma **transferência** e depois o aporte na conta de destino.
- Excluir uma reserva apaga o histórico dela e libera o valor (o dinheiro continua nas contas).

**Aporte mensal sugerido** = valor restante ÷ meses até o prazo (contando o mês atual e o do prazo), arredondado para cima no centavo.

## Indicadores do dashboard (sem dupla contagem)

| Indicador | Fórmula |
|---|---|
| Saldo disponível | Σ contas **operacionais** (saldo − reservado nelas) |
| Reservas financeiras | Σ reservado em todas as contas |
| Patrimônio líquido | Σ saldo de **todas** as contas − dívidas |

As reservas já estão **dentro** dos saldos das contas; por isso o patrimônio soma só os saldos, e nunca "saldos + reservas". Exemplo validado nos testes: corrente R$ 3.000 (R$ 1.000 reservados) + poupança R$ 5.000 (toda reservada) → disponível R$ 2.000, reservas R$ 6.000, patrimônio **R$ 8.000** (e não R$ 14.000).

Contas como poupança e investimento são, por padrão, **não operacionais**: entram no patrimônio, mas não no "disponível".

Se o reservado de uma conta ficar maior que o saldo dela (você gastou dinheiro reservado), o dashboard mostra um alerta.

## Cartões de crédito

| Conceito | Regra |
|---|---|
| **Compra no cartão** | Gera N parcelas que somam exatamente o total; a diferença de centavos vai na 1ª. Ex.: R$ 100 em 3x = 33,34 + 33,33 + 33,33. |
| **Fatura de cada compra** | Compra **antes** do dia de fechamento entra na fatura do mês; **no dia do fechamento ou depois**, na seguinte. Parcela k cai k−1 faturas depois. |
| **Vencimento** | No mesmo mês do fechamento se o dia de vencimento for maior que o de fechamento; senão, no mês seguinte. Dias 29–31 se ajustam ao último dia do mês. |
| **Datas gravadas** | Cada fatura guarda fechamento e vencimento. Mudar os dias do cartão vale só para faturas novas. |
| **Despesa (competência)** | Cada **parcela** é despesa no mês em que "aconteceu": 1ª na data da compra, 2ª um mês depois, e assim por diante. Entra nos gastos por categoria e nos orçamentos. |
| **Fluxo de caixa** | O cartão só aparece quando você **paga a fatura**: o pagamento é a saída de caixa, na categoria "Fatura do cartão". |
| **Pagamento da fatura** | Reduz o saldo da conta pagadora e a dívida do cartão. **Não é despesa por competência** (a despesa já são as parcelas) — nada é contado duas vezes. Pagamento parcial é permitido; o restante fica em aberto. |
| **Estorno no cartão** | Ligado à compra original, vira **crédito** na fatura da data do estorno e abate a despesa da mesma categoria. Não pode passar do valor da compra. |
| **Tarifas, juros, IOF** | Cobrança avulsa na fatura (despesa da categoria escolhida). **Crédito/ajuste a favor** subtrai. |
| **Dívida do cartão** | Parcelas já lançadas, **inclusive as futuras**, menos pagamentos. É o "limite usado" e é descontada do patrimônio líquido. |
| **Limite** | Só para acompanhamento. **Nunca** conta como dinheiro disponível. |
| **Saldo da fatura** | Cobranças − créditos − pagamentos. Negativo = crédito a favor. |

## Recorrências

- Cada recorrência tem frequência (semanal, quinzenal, mensal, a cada 2/3/6 meses, anual), data inicial e data final opcional. A data inicial define o dia: uma recorrência do dia 31 cai no último dia dos meses curtos.
- **Conta**: as ocorrências são criadas como **previstas (a pagar/receber)** até o fim do mês seguinte. Nunca são marcadas como pagas sozinhas, e previstas não mexem no saldo.
- **Cartão** (assinaturas): a cobrança é lançada no cartão na data de cada repetição, só até hoje.
- **Idempotência**: a geração pode rodar quantas vezes for — um índice único (recorrência + data) impede duplicatas, e uma "marca d'água" (`generated_until`) garante que uma ocorrência excluída por você não volta.
- **Editar só esta**: altera apenas aquele lançamento, que passa a ser ignorado por edições futuras da série.
- **Editar esta e as próximas**: a série antiga termina na véspera e uma nova começa com os dados novos. O passado não muda.
- **Encerrar**: remove as previstas a partir da data escolhida; o que já foi pago fica no histórico.

## Orçamentos

- Limite mensal por categoria de despesa.
- **Consumo** = despesa líquida da categoria no mês, por competência: lançamentos de conta (inclusive previstos) + parcelas do cartão − estornos.
- Avisos em **80%** e **100%** no dashboard e no planejamento.
- **Copiar para o mês seguinte** não sobrescreve orçamentos que já existem lá.
