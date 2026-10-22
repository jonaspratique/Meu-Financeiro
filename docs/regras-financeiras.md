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

## Cartões de crédito (Fase 2)

Regras já definidas para a próxima fase:

- **Compra no cartão** é despesa por **competência** na data da compra; parcelada gera N parcelas vinculadas cuja soma é exatamente o valor original (a diferença de centavos vai para a primeira parcela).
- **Fatura** agrupa as parcelas do ciclo (fechamento/vencimento).
- **Pagamento da fatura** reduz o saldo da conta pagadora e liquida a obrigação, **sem reconhecer a despesa de novo**.
- **Limite de crédito nunca é dinheiro disponível.** Faturas em aberto entram como dívida no patrimônio líquido.

Até lá, registre o pagamento da fatura como uma despesa comum.
