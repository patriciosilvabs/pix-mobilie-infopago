

## Plano: Adicionar campo "Nome da Despesa/Custo" com autocompletar baseado em histórico

### O que será feito

Adicionar um campo de texto entre a seleção de classificação (Custo/Despesa) e a seleção de categoria, onde o usuário digita o nome/descrição do pagamento. Conforme o usuário digita, o sistema mostra sugestões baseadas nas descrições mais usadas anteriormente (da mesma empresa), ordenadas por frequência.

### Detalhes técnicos

A tabela `transactions` já possui a coluna `description` (text, nullable) -- não é necessária migração.

**Arquivo: `src/pages/ReceiptCapture.tsx`**

1. Adicionar estado `expenseName` (string) e `expenseNameSuggestions` (lista de strings com contagem)
2. No `useEffect` que carrega categorias, também carregar as descrições mais usadas:
   - Query: `SELECT description, COUNT(*) as count FROM transactions WHERE company_id = ? AND description IS NOT NULL GROUP BY description ORDER BY count DESC LIMIT 50`
3. Adicionar campo de input com label "Nome do Custo/Despesa" logo após os botões Custo/Despesa e antes do seletor de Categoria
4. Ao digitar, filtrar as sugestões pelo texto digitado e exibir como lista dropdown (máximo ~5 sugestões), ordenadas por frequência
5. Ao clicar numa sugestão, preencher o campo
6. No `handleSubmit`, salvar o valor digitado no campo `description` da transação (junto com o update de `status` e `paid_at`)
7. Adicionar `expenseName` na interface `ReceiptData` (ou como estado separado)
8. Tornar o campo obrigatório para submissão (atualizar `canSubmit`)

### Comportamento esperado
- Usuário seleciona Custo ou Despesa
- Campo "Nome" aparece -- ao digitar, sugestões dos nomes mais usados aparecem abaixo
- Com o tempo, as sugestões ficam mais relevantes pois refletem o histórico real da empresa

