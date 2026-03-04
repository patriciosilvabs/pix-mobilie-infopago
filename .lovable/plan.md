

## Registro de Pagamento em Dinheiro

O objetivo é adicionar um novo tipo de pagamento "Dinheiro" que permite registrar pagamentos realizados em espécie, com obrigatoriedade de anexar o comprovante (foto do recibo/cupom) e classificar contabilmente.

### Como funciona

Diferente dos demais tipos (Pix, Boleto), o pagamento em dinheiro nao chama nenhuma API externa. Ele apenas cria o registro da transacao no banco de dados com `pix_type = 'cash'` e `status = 'completed'`, e redireciona imediatamente para a tela de anexar comprovante (`/pix/receipt/:id`).

### Alteracoes necessarias

**1. Banco de dados** -- Adicionar `'cash'` ao enum `pix_type`
- Executar migration: `ALTER TYPE pix_type ADD VALUE 'cash';`

**2. Novo Drawer `CashPaymentDrawer`**
- Formulario simples com: valor, nome do favorecido (quem recebeu o dinheiro), descricao opcional
- Ao confirmar, cria a transacao via `supabase.from("transactions").insert(...)` com `pix_type: 'cash'`, `status: 'completed'`, `paid_at: now()`
- Redireciona para `/pix/receipt/:transactionId` para anexar foto do recibo

**3. Dashboard Mobile** -- Adicionar botao "DINHEIRO" nas acoes rapidas
- Novo item no array `quickActions` com icone `Banknote` (lucide)
- Abre o `CashPaymentDrawer` ao clicar
- Feature key `dinheiro` para controle de permissoes

**4. Pagina NewPayment** -- Adicionar aba "Dinheiro"
- Nova tab no `TabsList` com o mesmo formulario simplificado (valor + favorecido)

**5. Ajustes no fluxo de comprovantes pendentes**
- `useDashboardData.ts`: incluir `pix_type = 'cash'` na lista de tipos que exigem comprovante manual (junto com qrcode, copy_paste, boleto)
- `Transactions.tsx`: tratar o tipo `cash` na lista de transacoes (icone de notas/dinheiro, label "Dinheiro")

### Secao tecnica

- O enum `pix_type` precisa da migration SQL antes de poder inserir `'cash'`
- O `CashPaymentDrawer` sera um Drawer (bottom-sheet) com 2 campos: valor obrigatorio e favorecido obrigatorio, seguido de botao "Registrar Pagamento"
- A transacao ja nasce como `completed` pois o dinheiro ja foi entregue fisicamente
- O sistema de comprovantes pendentes tratara `cash` igual a `qrcode`/`boleto` -- sem foto anexada = notificacao no dashboard

