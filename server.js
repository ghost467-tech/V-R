"use strict";

/**
 * VØĮR — servidor de relay
 * ============================================================
 * Responsabilidades deste servidor, e SÓ estas:
 *   1. Guardar chaves públicas de identidade (diretório público).
 *   2. Receber envelopes cifrados e guardá-los até o destinatário buscar.
 *   3. Entregar envelopes pendentes e apagá-los depois de entregues.
 *
 * O que ele NUNCA vê, por desenho: texto em claro, chave privada de
 * ninguém, o passo da cadeia, o alfabeto VØĮR, ou qualquer coisa que
 * precise da chave privada de A ou B para ser calculada.
 *
 * Armazenamento: em memória, de propósito. Reinicia o processo e tudo
 * some — isso é aceitável para um relay de mensagens (elas devem viver
 * pouco tempo no servidor mesmo), mas a tabela de identidades também
 * zera, o que não é ideal em produção. Para produção real, troque
 * `db` abaixo por Postgres (Supabase serve bem, já que você já usa
 * a ferramenta) ou Cloudflare D1/KV se for hospedar
 * como Worker. O contrato dos endpoints abaixo não muda.
 * ============================================================
 */

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

/* ============================================================
   "BANCO DE DADOS" EM MEMÓRIA
   ============================================================ */

const db = {
  // userId -> { publicKey: base64, registeredAt: iso }
  identities: new Map(),

  // envelopes pendentes, indexados por destinatário
  // userId -> array de envelopes
  inbox: new Map(),
};

const MAX_BUCKET_BYTES = 4096;
const MAX_INBOX_PER_USER = 500; // limite de segurança contra abuso
const USER_ID_RE = /^[a-zA-Z0-9_\-]{1,64}$/;

function isValidUserId(id) {
  return typeof id === "string" && USER_ID_RE.test(id);
}

function isValidBase64(value, maxLen = 8192) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLen;
}

/* ============================================================
   1. DIRETÓRIO DE CHAVES PÚBLICAS
   ============================================================ */

// Registra ou atualiza a chave pública de identidade de um usuário.
// Chamado uma vez por dispositivo, ao "abrir" a identidade local.
app.post("/api/identity", (req, res) => {
  const { userId, publicKey } = req.body || {};

  if (!isValidUserId(userId)) {
    return res.status(400).json({ error: "userId inválido (use letras, números, _ ou -, até 64 caracteres)." });
  }
  if (!isValidBase64(publicKey, 512)) {
    return res.status(400).json({ error: "publicKey ausente ou grande demais." });
  }

  db.identities.set(userId, {
    publicKey,
    registeredAt: new Date().toISOString(),
  });

  return res.status(201).json({ ok: true });
});

// Consulta a chave pública de alguém, para negociar uma sessão com ele.
app.get("/api/identity/:userId", (req, res) => {
  const { userId } = req.params;
  const entry = db.identities.get(userId);

  if (!entry) {
    return res.status(404).json({ error: "Essa identidade ainda não se registrou no servidor." });
  }

  return res.json({ userId, publicKey: entry.publicKey });
});

/* ============================================================
   2. ENVIO DE ENVELOPES CIFRADOS
   ============================================================ */

// Recebe um envelope opaco e o guarda na caixa de entrada do destinatário.
// Tudo aqui dentro já chega cifrado — o servidor só confere formato.
app.post("/api/send", (req, res) => {
  const { to, from, ephemeralPub, iv, ciphertext, bucket } = req.body || {};

  if (!isValidUserId(to) || !isValidUserId(from)) {
    return res.status(400).json({ error: "to/from inválidos." });
  }
  if (!db.identities.has(to)) {
    return res.status(404).json({ error: "Destinatário não registrado." });
  }
  if (!isValidBase64(ephemeralPub, 512) || !isValidBase64(iv, 64) || !isValidBase64(ciphertext, MAX_BUCKET_BYTES * 2)) {
    return res.status(400).json({ error: "Envelope malformado." });
  }
  if (![64, 256, 1024, 4096].includes(bucket)) {
    return res.status(400).json({ error: "bucket fora do conjunto permitido — isso quebraria o padding uniforme." });
  }

  const queue = db.inbox.get(to) || [];
  if (queue.length >= MAX_INBOX_PER_USER) {
    return res.status(429).json({ error: "Caixa de entrada do destinatário está cheia. Tente depois." });
  }

  const envelope = {
    id: crypto.randomUUID(),
    to,
    from,
    ephemeralPub,
    iv,
    ciphertext,
    bucket,
    receivedAt: new Date().toISOString(),
  };

  queue.push(envelope);
  db.inbox.set(to, queue);

  return res.status(201).json({ ok: true, id: envelope.id });
});

/* ============================================================
   3. CAIXA DE ENTRADA
   ============================================================ */

// Devolve todos os envelopes pendentes de um usuário e os remove do
// servidor — uma vez entregues, não ficam mais guardados aqui.
app.get("/api/inbox/:userId", (req, res) => {
  const { userId } = req.params;

  if (!isValidUserId(userId)) {
    return res.status(400).json({ error: "userId inválido." });
  }

  const queue = db.inbox.get(userId) || [];
  db.inbox.set(userId, []); // esvazia — entrega única

  return res.json({ envelopes: queue });
});

/* ============================================================
   STATUS / SAÚDE
   ============================================================ */

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    identities: db.identities.size,
    pendingEnvelopes: Array.from(db.inbox.values()).reduce((n, q) => n + q.length, 0),
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`VØĮR relay ouvindo em http://localhost:${PORT}`);
  console.log("Endpoints: POST /api/identity · GET /api/identity/:id · POST /api/send · GET /api/inbox/:id · GET /api/status");
});
