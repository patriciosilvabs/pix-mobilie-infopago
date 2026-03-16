# Ponto Eletronico + Folha de Pagamento + Pix ONZ

Aplicacao completa criada do zero para:
- Cadastrar colaboradores
- Registrar ponto (entrada/saida)
- Fechar folha mensal
- Pagar folha via Pix usando API da ONZ InfoPago

## Stack
- Backend: Node.js nativo (`http`, `fs`, `fetch`)
- Frontend: HTML/CSS/JS
- Persistencia: arquivo JSON local (`data/db.json`)

## Estrutura
- `src/server.js`: API REST + integracao ONZ
- `public/index.html`: painel web
- `data/db.json`: base local
- `.env.example`: configuracoes

## Como executar
1. Entre na pasta do projeto:
   ```bash
   cd ponto-eletronico-onz
   ```
2. Copie o arquivo de ambiente:
   ```bash
   copy .env.example .env
   ```
3. Inicie:
   ```bash
   npm start
   ```
4. Abra no navegador:
   - `http://localhost:3333`

## Integracao ONZ InfoPago
A API foi implementada com base no arquivo `accounts-api (1).yaml`:
- `POST /oauth/token`
- `POST /pix/payments/dict`

### Modo mock (padrao)
- `ONZ_MOCK=true`
- Nao faz chamada externa, mas registra pagamentos Pix simulados.

### Modo real
1. Configure no `.env`:
   - `ONZ_MOCK=false`
   - `ONZ_CLIENT_ID=<seu_client_id>`
   - `ONZ_CLIENT_SECRET=<seu_client_secret>`
2. Reinicie o servidor.
3. Os pagamentos da folha passarao a usar a ONZ em `ONZ_BASE_URL`.

## Endpoints principais
- `GET /api/health`
- `GET/POST /api/employees`
- `POST /api/time-entries/clock-in`
- `POST /api/time-entries/clock-out`
- `GET /api/time-entries?employeeId=&month=YYYY-MM`
- `POST /api/payroll/close-month`
- `GET /api/payroll?month=YYYY-MM`
- `POST /api/payroll/{id}/pay-via-pix`
- `GET /api/pix/events`

## Regra de calculo da folha
- Carga mensal padrao: `220h`
- Hora extra: acima de `220h`
- Adicional hora extra: `50%`
- INSS simplificado: `8%` sobre salario bruto
- Liquido = bruto - INSS

## Observacoes
- Projeto pronto para evoluir para banco SQL (PostgreSQL/MySQL) e autenticacao por perfil.
- Para producao, adicione assinatura/validacao de webhooks da ONZ e trilha de auditoria.
