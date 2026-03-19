// ── logger.js — Structured logger (no stack trace in production) ─────────────
const IS_DEV = process.env.NODE_ENV !== 'production';

module.exports = {
  error: (context, err) => {
    if (IS_DEV) {
      console.error(`[ERROR] [${context}]`, err);
    } else {
      // In production: log only the message, never the stack
      console.error(`[ERROR] [${context}] ${err?.message || err}`);
    }
  },
  warn: (context, msg) => {
    console.warn(`[WARN] [${context}] ${msg}`);
  },
  info: (context, msg) => {
    if (IS_DEV) console.log(`[INFO] [${context}] ${msg}`);
  },
};
