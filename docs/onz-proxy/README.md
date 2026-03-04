# ONZ mTLS Proxy

Proxy Node.js para resolver o erro `NotValidForName` ao conectar com a ONZ Infopago.

O runtime Deno (rustls) rejeita certificados TLS sem SubjectAltName (SAN). Node.js (OpenSSL) aceita.

## Deploy no Railway

1. Crie um repositório no GitHub com os arquivos `index.js`, `package.json` e este README
2. Acesse [railway.app](https://railway.app) e crie um novo projeto a partir do repositório
3. Configure as variáveis de ambiente no Railway:

| Variável | Valor |
|---|---|
| `PROXY_API_KEY` | Gere uma chave aleatória (ex: `openssl rand -hex 32`) |
| `ONZ_CLIENT_CERT_B64` | Conteúdo do certificado .crt em Base64 (mesmo valor usado no `certificate_encrypted` da tabela `pix_configs`) |
| `ONZ_CLIENT_KEY_B64` | Conteúdo da chave .key em Base64 (mesmo valor do `certificate_key_encrypted`) |
| `ONZ_CA_CERT_B64` | (Opcional) CA cert da ONZ em Base64, se necessário |

4. Faça deploy — o Railway fornecerá uma URL como `https://seu-proxy.up.railway.app`
5. Teste: `curl https://seu-proxy.up.railway.app/health`

## Deploy no Render

1. Crie um **Web Service** no [render.com](https://render.com) apontando para o repositório
2. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
3. Adicione as mesmas variáveis de ambiente listadas acima
4. Deploy automático

## Após o deploy

Volte ao Lovable e forneça:
1. **ONZ_PROXY_URL** — a URL do proxy (ex: `https://seu-proxy.up.railway.app`)
2. **ONZ_PROXY_API_KEY** — a chave que você definiu em `PROXY_API_KEY`

O Lovable atualizará as Edge Functions para usar o proxy automaticamente.
