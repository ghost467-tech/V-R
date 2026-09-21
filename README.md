# VØĮR — projeto completo (frontend + backend)

Mensageiro privado: cada dispositivo tem sua identidade (ECDH/P-256), as
mensagens são cifradas no navegador (AES-256-GCM) com uma chave efêmera
nova a cada mensagem (ratchet duplo), e o servidor só relaia envelopes
opacos — nunca vê texto, chave privada, passo da cadeia ou o alfabeto
VØĮR usado.

## Estrutura

```
voir-full/
├── backend/
│   ├── server.js       servidor de relay (Express)
│   └── package.json
├── frontend/
│   └── index.html      cliente — abre direto no navegador, sem build
└── README.md            este arquivo
```

## Como rodar

### 1. Backend

```bash
cd backend
npm install
npm start
```

Isso sobe o relay em `http://localhost:3001`. Endpoints:

| Método | Rota                    | O que faz |
|---|---|---|
| POST | `/api/identity`         | registra/atualiza a chave pública de um `userId` |
| GET  | `/api/identity/:userId` | consulta a chave pública de alguém |
| POST | `/api/send`             | entrega um envelope cifrado a um destinatário |
| GET  | `/api/inbox/:userId`    | busca (e apaga) os envelopes pendentes de alguém |
| GET  | `/api/status`           | saúde do servidor |

### 2. Frontend

Abra `frontend/index.html` direto no navegador (duplo clique, ou
`npx serve frontend`). Não precisa de build nem de instalar nada — é
um arquivo único.

### 3. Testar uma conversa

1. Abra `index.html` em duas abas (ou dois dispositivos na mesma rede,
   trocando `localhost` pelo IP da máquina que roda o backend).
2. Na aba 1: `Meu ID = alice`, clique **Gerar identidade e registrar**.
3. Na aba 2: `Meu ID = bob`, clique **Gerar identidade e registrar**.
4. Na aba 1: `ID de quem eu falo = bob`, clique **Iniciar conversa**.
5. Na aba 2: `ID de quem eu falo = alice`, clique **Iniciar conversa**.
6. Mande mensagem de qualquer lado — chega na outra aba em até 3s
   (intervalo do polling).

## O que está implementado de verdade

- **Identidade real por dispositivo** — cada aba/navegador gera seu
  próprio par de chaves, independente. Não existe mais "os dois lados
  na mesma aba" do protótipo anterior.
- **Sessão multiusuário no servidor** — qualquer `userId` pode
  registrar e conversar com qualquer outro, não só um par fixo A/B.
- **Ratchet duplo real** — chave efêmera nova por mensagem, forward
  secrecy e healing, exatamente como documentado antes, agora rodando
  entre dois processos de navegador separados de verdade, não
  simulado numa função só.
- **Duas cadeias por par de usuários** (uma para cada sentido, rotuladas
  de forma determinística pela ordem alfabética dos IDs) — suporta
  conversa nos dois sentidos sem cruzar chaves.
- **Servidor que não vê conteúdo** — o `server.js` só grava e devolve
  bytes opacos; dá pra conferir isso lendo o arquivo inteiro, são
  ~150 linhas.

## O que ainda é simplificação deliberada, não escondida

- **Armazenamento em memória no servidor.** Reiniciar o processo apaga
  identidades e mensagens pendentes. Para produção, troque o objeto
  `db` em `server.js` por Postgres (Supabase, já que você já usa) ou
  Cloudflare D1/KV se for rodar como Worker — o contrato dos endpoints
  não muda, só a implementação de `db.identities` e `db.inbox`.
- **Polling, não push.** O cliente pergunta a cada 3s se tem mensagem
  nova. Funciona, mas gasta bateria/rede à toa. Um `WebSocket` ou
  `Server-Sent Events` resolveria isso — não implementado aqui.
- **Sem persistência de identidade no navegador.** Fechar a aba perde
  o par de chaves — você precisa gerar de novo (e o outro lado vai
  falhar ao decifrar mensagens antigas, porque a cadeia dependia da
  chave antiga). Um app real guardaria a chave privada em
  IndexedDB cifrado por senha local, ou no Android Keystore/Secure
  Enclave num app nativo.
- **Sem lidar com mensagens fora de ordem.** Se duas mensagens saírem
  quase juntas e chegarem trocadas, a cadeia perde sincronia e a
  decodificação falha. O Double Ratchet de verdade (Signal) guarda um
  pequeno cache de chaves "puladas" pra cobrir isso — não implementado.
- **Sem autenticação de verdade.** Qualquer um pode registrar qualquer
  `userId` — não tem senha, prova de posse, nem nada que impeça
  alguém de "roubar" um nome de usuário livre. Para produção isso
  precisa de login de verdade antes do registro da chave pública.
- **Metadados continuam visíveis ao servidor** — quem fala com quem e
  quando, exatamente como documentado desde o início deste projeto.
  Resolver isso é rede de anonimato (Tor ou equivalente), infra
  externa a este código.
- **Nenhuma auditoria externa.** Isso vale pra qualquer sistema
  criptográfico que alguém escreve sozinho, este incluso.

## Próximos passos sugeridos, em ordem de impacto

1. Trocar polling por WebSocket (entrega quase instantânea, menos
   round-trips).
2. Persistir identidade localmente (IndexedDB) para sobreviver a
   recarregar a página.
3. Trocar o armazenamento em memória do backend por Postgres/Supabase.
4. Autenticação real antes de registrar um `userId`.
5. Double Ratchet completo (mensagens fora de ordem).
6. App Android nativo, se o alvo final for mobile — este frontend é
   web porque é o que dá para prototipar e testar rápido, mas o
   protocolo (as funções de cripto no `<script>` do `index.html`)
   se traduz quase 1:1 pra Kotlin usando o Android Keystore no lugar
   do WebCrypto.
