const session = require('express-session');
const SQLiteStore = require('better-sqlite3-session-store')(session);
const { getDb } = require('./db');

function createSessionMiddleware() {
  const db = getDb();
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.SESSION_SECRET || 'spotiqueue-dev-session-secret';
  if (isProduction && !process.env.SESSION_SECRET) {
    console.warn('WARNING: SESSION_SECRET is not set. Set it in production.');
  }
  // A "Secure" cookie is only ever stored by the browser over HTTPS. Plenty of
  // production deployments of this app are plain HTTP on a LAN/127.0.0.1 with
  // no reverse proxy in front, so tying this strictly to NODE_ENV silently
  // breaks admin login there (the cookie never gets set, login just "blinks").
  // Let COOKIE_SECURE override the default; only set it 'true' if this is
  // actually served over HTTPS (directly or via a TLS-terminating proxy).
  const cookieSecure = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : isProduction;

  return session({
    store: new SQLiteStore({
      client: db,
      expired: {
        clear: true,
        intervalMs: 15 * 60 * 1000
      }
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    name: 'spotiqueue.admin.sid',
    cookie: {
      secure: cookieSecure,
      httpOnly: true,
      // SameSite=None is required for cross-site setups (e.g. admin frontend
      // on Vercel calling an admin API on Render) and requires Secure; for a
      // same-origin plain-HTTP deployment, Lax is what actually works.
      sameSite: cookieSecure ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  });
}

module.exports = { createSessionMiddleware };
