const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

/** Keys admins may view/edit from the panel. Secrets are masked on read. */
const EDITABLE_ENV = [
  {
    key: 'SPOTIFY_CLIENT_ID',
    label: 'Spotify Client ID',
    help: 'From the Spotify Developer Dashboard.',
    secret: false,
    needsRestart: false
  },
  {
    key: 'SPOTIFY_CLIENT_SECRET',
    label: 'Spotify Client Secret',
    help: 'From the Spotify Developer Dashboard.',
    secret: true,
    needsRestart: false
  },
  {
    key: 'SPOTIFY_REDIRECT_URI',
    label: 'Spotify Redirect URI',
    help: 'Optional override. Leave empty to auto-detect. Must use 127.0.0.1, not localhost.',
    secret: false,
    needsRestart: false
  },
  {
    key: 'SPOTIFY_REFRESH_TOKEN',
    label: 'Spotify Refresh Token',
    help: 'Usually set via Connect Spotify. You can paste one manually if needed.',
    secret: true,
    needsRestart: false
  },
  {
    key: 'SPOTIFY_USER_ID',
    label: 'Spotify User ID',
    help: 'Usually set via Connect Spotify.',
    secret: false,
    needsRestart: false
  },
  {
    key: 'CLIENT_URL',
    label: 'Client URL',
    help: 'Public guest app origin (CORS + OAuth redirects). Restart required after change.',
    secret: false,
    needsRestart: true
  },
  {
    key: 'ADMIN_CLIENT_URL',
    label: 'Admin Client URL',
    help: 'Admin UI origin in development (CORS + cookies). Restart required after change.',
    secret: false,
    needsRestart: true
  },
  {
    key: 'ADMIN_PORT',
    label: 'Admin Port',
    help: 'Port for the admin HTTP server. Restart required after change.',
    secret: false,
    needsRestart: true
  },
  {
    key: 'SESSION_SECRET',
    label: 'Session Secret',
    help: 'Signs admin session cookies. Use a long random value in production. Restart required.',
    secret: true,
    needsRestart: true
  },
  {
    key: 'ADMIN_TOTP_SECRET',
    label: 'Admin TOTP Secret',
    help: 'Optional base32 secret; when set, login requires an authenticator code.',
    secret: true,
    needsRestart: false
  },
  {
    key: 'GITHUB_CLIENT_ID',
    label: 'GitHub Client ID',
    help: 'Optional. Required if guests must sign in with GitHub.',
    secret: false,
    needsRestart: false
  },
  {
    key: 'GITHUB_CLIENT_SECRET',
    label: 'GitHub Client Secret',
    help: 'Optional. Required if guests must sign in with GitHub.',
    secret: true,
    needsRestart: false
  },
  {
    key: 'GITHUB_REDIRECT_URI',
    label: 'GitHub Redirect URI',
    help: 'Optional override. Defaults to CLIENT_URL/api/github/callback.',
    secret: false,
    needsRestart: false
  },
  {
    key: 'GOOGLE_CLIENT_ID',
    label: 'Google Client ID',
    help: 'Optional. Required if guests must sign in with Google.',
    secret: false,
    needsRestart: false
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    label: 'Google Client Secret',
    help: 'Optional. Required if guests must sign in with Google.',
    secret: true,
    needsRestart: false
  },
  {
    key: 'GOOGLE_REDIRECT_URI',
    label: 'Google Redirect URI',
    help: 'Optional override. Defaults to CLIENT_URL/api/google/callback.',
    secret: false,
    needsRestart: false
  },
  {
    key: 'DB_PATH',
    label: 'Database Path',
    help: 'SQLite database file path. Restart required after change.',
    secret: false,
    needsRestart: true
  }
];

const EDITABLE_KEYS = new Set(EDITABLE_ENV.map((e) => e.key));

function getEnvPath() {
  return ENV_PATH;
}

function readEnvFileRaw() {
  if (!fs.existsSync(ENV_PATH)) {
    return '';
  }
  return fs.readFileSync(ENV_PATH, 'utf8');
}

/**
 * Parse .env into a map. Keeps last occurrence if a key is repeated.
 * Values are not unquoted beyond trimming surrounding quotes.
 */
function parseEnvContent(content) {
  const map = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

function escapeEnvValue(value) {
  const s = String(value ?? '').replace(/[\r\n]/g, '');
  if (/[\s#"'\\]/.test(s) || s === '') {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Set or add a key in .env content. Preserves comments and other lines.
 */
function setEnvKeyInContent(content, key, value) {
  const line = `${key}=${escapeEnvValue(value)}`;
  const lines = String(content || '').split(/\r?\n/);
  let found = false;
  const next = lines.map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return raw;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return raw;
    if (trimmed.slice(0, eq).trim() !== key) return raw;
    found = true;
    // Preserve leading whitespace / indentation if any
    const leading = raw.match(/^\s*/)?.[0] || '';
    return `${leading}${line}`;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== '') {
      next.push('');
    }
    next.push(line);
  }
  return next.join('\n').replace(/\n*$/, '\n');
}

/**
 * Remove a key from .env content.
 */
function removeEnvKeyInContent(content, key) {
  const lines = String(content || '').split(/\r?\n/);
  const next = lines.filter((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return true;
    return trimmed.slice(0, eq).trim() !== key;
  });
  return next.join('\n').replace(/\n*$/, '\n');
}

function writeEnvContent(content) {
  fs.writeFileSync(ENV_PATH, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function setEnvVar(key, value) {
  if (!EDITABLE_KEYS.has(key)) {
    throw new Error(`Env key not editable: ${key}`);
  }
  const content = setEnvKeyInContent(readEnvFileRaw(), key, value);
  writeEnvContent(content);
  process.env[key] = String(value ?? '');
}

function removeEnvVar(key) {
  if (!EDITABLE_KEYS.has(key)) {
    throw new Error(`Env key not editable: ${key}`);
  }
  const content = removeEnvKeyInContent(readEnvFileRaw(), key);
  writeEnvContent(content);
  delete process.env[key];
}

function getCurrentEnvValue(key) {
  const fromFile = parseEnvContent(readEnvFileRaw())[key];
  if (fromFile !== undefined) return fromFile;
  return process.env[key] ?? '';
}

function listEditableEnvForAdmin() {
  return EDITABLE_ENV.map((meta) => {
    const raw = getCurrentEnvValue(meta.key);
    const isSet = !!(raw && String(raw).trim() !== '');
    return {
      key: meta.key,
      label: meta.label,
      help: meta.help,
      secret: meta.secret,
      needsRestart: meta.needsRestart,
      isSet,
      // Never return secret values to the client; non-secrets are editable in place
      value: meta.secret ? '' : raw
    };
  });
}

module.exports = {
  EDITABLE_ENV,
  EDITABLE_KEYS,
  getEnvPath,
  readEnvFileRaw,
  parseEnvContent,
  setEnvKeyInContent,
  removeEnvKeyInContent,
  writeEnvContent,
  setEnvVar,
  removeEnvVar,
  getCurrentEnvValue,
  listEditableEnvForAdmin
};
