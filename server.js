/**
 * BLACKGIFT AI — server.js
 * Express server with:
 *  - Redis-backed sessions (connect-redis + ioredis)
 *  - Firebase ID token verification (Firebase Admin)
 *  - Firestore per-user persistent history (authenticated users)
 *  - Token estimation & trimming (gpt-3-encoder)
 *  - Official OpenAI Node client
 *
 * Deployment-ready: set required environment variables (see README).
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const Redis = require('ioredis');
const connectRedis = require('connect-redis');
const admin = require('firebase-admin');
const { encode } = require('gpt-3-encoder');
const OpenAI = require('openai');

const APP_NAME = 'BLACKGIFT AI';
const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const HISTORY_MAX_TOKENS = parseInt(process.env.HISTORY_MAX_TOKENS || '3000', 10);

if (!OPENAI_KEY) {
  console.warn(`[${APP_NAME}] Warning: OPENAI_API_KEY is not set. Set it in your environment or secret store.`);
}

const openai = new OpenAI({ apiKey: OPENAI_KEY });

// Initialize Firebase Admin (uses GOOGLE_APPLICATION_CREDENTIALS or env defaults)
try {
  admin.initializeApp();
  console.log(`[${APP_NAME}] Firebase Admin initialized.`);
} catch (err) {
  console.warn(`[${APP_NAME}] Firebase Admin initialization issue: ${err?.message || err}`);
}

const firestore = admin.firestore ? admin.firestore() : null;

// Redis-backed session store
const RedisStore = connectRedis(session);
const redisClient = new Redis(REDIS_URL);
redisClient.on('error', (err) => console.error(`[${APP_NAME}] Redis error:`, err));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

const SYSTEM_PROMPT = `Ndiri mubatsiri we${APP_NAME}. Gara uchipindura muChiShona (Shona) chete. Kana mushandisi akakumbira kuchinja mutauro, bvunza mubvunzo muChiShona kuti uverenge kana vachida kuchinja. Shandisa mutauro unonzwisisika, wakapfava, uye unoenderana nemamiriro emubvunzo.`;

/* ------------------ Authentication middleware ------------------ */

/**
 * If Authorization: Bearer <idToken> is provided, try to verify via Firebase Admin.
 * On success set req.user = { uid, email }.
 * If Admin not initialized or verification fails, continue as anonymous.
 */
async function maybeAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return next();
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) return next();
  if (!admin.apps.length || !admin.auth) {
    console.warn(`[${APP_NAME}] Firebase Admin unavailable; cannot verify ID tokens.`);
    return next();
  }
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = { uid: decoded.uid, email: decoded.email || null };
  } catch (err) {
    console.warn(`[${APP_NAME}] Failed to verify ID token: ${err?.message || err}`);
  }
  return next();
}
app.use(maybeAuthenticate);

/* ------------------ Token estimation helpers ------------------ */

function countTokensForContent(text) {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch (e) {
    return Math.ceil(text.length / 4);
  }
}

function countTokensForMessagesArray(messages) {
  let total = 0;
  for (const m of messages) {
    total += countTokensForContent(m.content) + 4;
  }
  return total + 2;
}

/* ------------------ Firestore user-history helpers ------------------ */

async function loadUserHistory(uid) {
  if (!firestore) return null;
  const docRef = firestore.collection('user_histories').doc(uid);
  const snap = await docRef.get();
  if (!snap.exists) {
    await docRef.set({
      history: [{ role: 'system', content: SYSTEM_PROMPT, ts: Date.now() }],
      total_tokens: countTokensForContent(SYSTEM_PROMPT),
      token_usage: { total: 0, last_updated: Date.now() },
      updated_at: Date.now()
    });
    return { history: [{ role: 'system', content: SYSTEM_PROMPT }], total_tokens: countTokensForContent(SYSTEM_PROMPT) };
  }
  const data = snap.data();
  return {
    history: data.history || [{ role: 'system', content: SYSTEM_PROMPT }],
    total_tokens: data.total_tokens || 0
  };
}

async function saveUserHistory(uid, history, total_tokens) {
  if (!firestore) return;
  const docRef = firestore.collection('user_histories').doc(uid);
  await docRef.set({
    history: history.map(m => ({ role: m.role, content: m.content, ts: m.ts || Date.now() })),
    total_tokens: total_tokens,
    updated_at: Date.now()
  }, { merge: true });
}

async function addUserTokenUsage(uid, tokensUsed) {
  if (!firestore) return;
  const docRef = firestore.collection('user_histories').doc(uid);
  await firestore.runTransaction(async tx => {
    const snap = await tx.get(docRef);
    const data = snap.exists ? snap.data() : {};
    const current = data.token_usage?.total || 0;
    tx.set(docRef, {
      token_usage: { total: current + tokensUsed, last_updated: Date.now() }
    }, { merge: true });
  });
}

/* ------------------ Session helpers ------------------ */

function ensureAnonHistory(req) {
  if (!req.session.history || !Array.isArray(req.session.history)) {
    req.session.history = [{ role: 'system', content: SYSTEM_PROMPT, ts: Date.now() }];
    req.session.history_total_tokens = countTokensForContent(SYSTEM_PROMPT);
  }
}

/* Trim messages to fit max token budget. Keep system prompt at index 0. */
function trimMessagesByTokenBudget(messages, maxTokens) {
  if (!messages || messages.length === 0) return { messages: [{ role: 'system', content: SYSTEM_PROMPT }], totalTokens: countTokensForContent(SYSTEM_PROMPT) };
  let total = countTokensForMessagesArray(messages);
  if (total <= maxTokens) return { messages, totalTokens: total };
  const system = messages[0];
  let rest = messages.slice(1);
  while (rest.length > 0 && total > maxTokens) {
    rest.shift();
    total = countTokensForMessagesArray([system, ...rest]);
  }
  return { messages: [system, ...rest], totalTokens: total };
}

/* Build conversation messages depending on authenticated or anonymous user */
async function buildConversation(req, userMessage) {
  if (req.user && req.user.uid && firestore) {
    const uid = req.user.uid;
    const loaded = await loadUserHistory(uid);
    let history = (loaded.history || [{ role: 'system', content: SYSTEM_PROMPT }]).map(h => ({ role: h.role, content: h.content, ts: h.ts || Date.now() }));
    history.push({ role: 'user', content: userMessage, ts: Date.now() });
    const { messages: trimmed, totalTokens } = trimMessagesByTokenBudget(history, HISTORY_MAX_TOKENS);
    return { messages: trimmed, totalTokens, persistsTo: 'firestore', uid };
  } else {
    ensureAnonHistory(req);
    req.session.history.push({ role: 'user', content: userMessage, ts: Date.now() });
    const { messages: trimmed, totalTokens } = trimMessagesByTokenBudget(req.session.history, HISTORY_MAX_TOKENS);
    req.session.history = trimmed;
    req.session.history_total_tokens = totalTokens;
    return { messages: trimmed, totalTokens, persistsTo: 'session' };
  }
}

/* ------------------ Routes ------------------ */

app.post('/api/chat', async (req, res) => {
  try {
    const userMessage = (req.body?.message || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'message is required' });

    const { messages, totalTokens, persistsTo, uid } = await buildConversation(req, userMessage);
    const openaiMessages = messages.map(m => ({ role: m.role, content: m.content }));

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: openaiMessages,
      max_tokens: 800,
      temperature: 0.7
    });

    const assistantText = completion?.choices?.[0]?.message?.content || 'Handina kupindura zvakanaka. Edza zvakare.';
    const promptTokens = countTokensForMessagesArray(openaiMessages);
    const completionTokens = countTokensForContent(assistantText);
    const totalRequestTokens = promptTokens + completionTokens;

    if (persistsTo === 'firestore' && uid) {
      const loaded = await loadUserHistory(uid);
      const history = loaded.history || [{ role: 'system', content: SYSTEM_PROMPT }];
      history.push({ role: 'user', content: userMessage, ts: Date.now() });
      history.push({ role: 'assistant', content: assistantText, ts: Date.now() });
      const { messages: trimmed, totalTokens: newTotal } = trimMessagesByTokenBudget(history, HISTORY_MAX_TOKENS);
      await saveUserHistory(uid, trimmed, newTotal);
      await addUserTokenUsage(uid, totalRequestTokens);
    } else {
      ensureAnonHistory(req);
      req.session.history.push({ role: 'assistant', content: assistantText, ts: Date.now() });
      const { messages: trimmed, totalTokens: newTotal } = trimMessagesByTokenBudget(req.session.history, HISTORY_MAX_TOKENS);
      req.session.history = trimmed;
      req.session.history_total_tokens = newTotal;
    }

    res.json({ reply: assistantText, tokens: { prompt: promptTokens, completion: completionTokens, total: totalRequestTokens } });
  } catch (err) {
    console.error(`[${APP_NAME}] Error:`, err);
    const details = err?.response?.data ?? err?.message ?? String(err);
    res.status(500).json({ error: 'Failed to process chat', details });
  }
});

app.post('/api/reset', async (req, res) => {
  try {
    if (req.user && req.user.uid && firestore) {
      const uid = req.user.uid;
      await saveUserHistory(uid, [{ role: 'system', content: SYSTEM_PROMPT }], countTokensForContent(SYSTEM_PROMPT));
      return res.json({ ok: true, message: 'User history reset.' });
    } else {
      req.session.history = [{ role: 'system', content: SYSTEM_PROMPT, ts: Date.now() }];
      req.session.history_total_tokens = countTokensForContent(SYSTEM_PROMPT);
      return res.json({ ok: true, message: 'Session history reset.' });
    }
  } catch (err) {
    console.error(`[${APP_NAME}] Reset error:`, err);
    res.status(500).json({ error: 'Failed to reset history', details: err?.message ?? String(err) });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    if (req.user && req.user.uid && firestore) {
      const loaded = await loadUserHistory(req.user.uid);
      return res.json({ history: loaded.history || [] });
    } else {
      ensureAnonHistory(req);
      return res.json({ history: req.session.history || [] });
    }
  } catch (err) {
    console.error(`[${APP_NAME}] History error:`, err);
    res.status(500).json({ error: 'Failed to load history', details: err?.message ?? String(err) });
  }
});

app.get('/api/usage', async (req, res) => {
  if (!req.user || !req.user.uid || !firestore) {
    return res.status(401).json({ error: 'Authentication required to view usage' });
  }
  try {
    const docRef = firestore.collection('user_histories').doc(req.user.uid);
    const snap = await docRef.get();
    if (!snap.exists) return res.json({ usage: { total: 0 } });
    const data = snap.data();
    return res.json({ usage: data.token_usage || { total: 0 } });
  } catch (err) {
    console.error(`[${APP_NAME}] Usage error:`, err);
    res.status(500).json({ error: 'Failed to load usage', details: err?.message ?? String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[${APP_NAME}] Server listening on http://localhost:${PORT}`);
});