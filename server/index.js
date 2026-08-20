const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
// ENV_FILE_PATH lets a host with only one persistent mount (e.g. a single
// Render disk) point this at the same disk as the SQLite DB - see envFile.js.
require('dotenv').config(process.env.ENV_FILE_PATH ? { path: process.env.ENV_FILE_PATH } : undefined);

const fingerprintRouter = require('./routes/fingerprint');
const queueRouter = require('./routes/queue');
const nowPlayingRouter = require('./routes/nowPlaying');
const adminRouter = require('./routes/admin');
const configRouter = require('./routes/config');
const authRouter = require('./routes/auth');
const githubAuthRouter = require('./routes/github-auth');
const googleAuthRouter = require('./routes/google-auth');
const prequeueRouter = require('./routes/prequeue');
const playbackRouter = require('./routes/playback');
const { processExpiredPendingQueues } = require('./routes/queue');
const { initDatabase } = require('./db');
const { createSessionMiddleware } = require('./sessionMiddleware');

// In development, use port 5000 for backend API (React dev server uses 3000)
// In production, use port 3000
// Check if we're in production by checking if NODE_ENV is explicitly set to 'production'
const isProduction = process.env.NODE_ENV === 'production';

// The app is normally two Express apps in one process on two ports (public
// guest API + admin API), sharing one SQLite file - this is what
// docker-compose runs. SERVICE_ROLE=merged instead runs ONE Express app on
// ONE port, for hosting platforms (e.g. Render) that only route traffic to a
// single $PORT per service. Splitting into two separate *services* would
// mean two separate SQLite files with no way to share state between them, so
// "merged" (not "split") is the supported way to deploy this to such a
// platform - the frontends are expected to be hosted separately (e.g.
// Vercel) either way, since this covers only the API.
const MERGED = process.env.SERVICE_ROLE === 'merged';

function registerRoutes(target) {
  target.use('/api/fingerprint', fingerprintRouter);
  target.use('/api/queue', queueRouter);
  target.use('/api/now-playing', nowPlayingRouter);
  target.use('/api/admin', adminRouter);
  target.use('/api/config', configRouter);
  target.use('/api/auth', authRouter);
  target.use('/api/github', githubAuthRouter);
  target.use('/api/google', googleAuthRouter);
  target.use('/api/prequeue', prequeueRouter);
}

// Initialize database (before session store uses DB)
initDatabase();
const sessionMiddleware = createSessionMiddleware();

setInterval(() => {
  processExpiredPendingQueues().catch(err => {
    console.error('Pending queue processor error:', err);
  });
}, 1000);

if (MERGED) {
  // Single app, single port: CORS must accept requests from BOTH the guest
  // frontend origin and the admin frontend origin, since one process now
  // serves both instead of each having its own dedicated origin/port.
  const PORT = process.env.PORT || 3000;
  const allowedOrigins = new Set(
    [process.env.CLIENT_URL, process.env.ADMIN_CLIENT_URL]
      .filter(Boolean)
      .map((u) => u.replace(/\/$/, ''))
  );

  console.log(`Server mode: production (merged), port: ${PORT}, allowed origins: ${[...allowedOrigins].join(', ') || '(none configured)'}`);

  const app = express();
  app.set('trust proxy', 1);
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // server-to-server / curl / health checks
      return cb(null, allowedOrigins.has(origin.replace(/\/$/, '')));
    },
    credentials: true
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(sessionMiddleware);

  registerRoutes(app);
  app.use('/api/playback', playbackRouter);

  const server = app.listen(PORT, () => {
    console.log(`Merged server running on port ${PORT}`);
  });
  server.on('error', (err) => {
    console.error(`Server failed to bind port ${PORT}:`, err.message);
    process.exit(1);
  });
} else {
  // In development, ALWAYS use 5000 to avoid conflict with React dev server on 3000
  // Force override any PORT from .env file in development
  let PORT;
  if (isProduction) {
    PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  } else {
    // Development mode - FORCE port 5000, ignore any PORT from .env
    PORT = 5000;
    // Explicitly delete PORT from env to prevent any other code from using it
    delete process.env.PORT;
  }
  const ADMIN_PORT = process.env.ADMIN_PORT || 3001;

  console.log(`Server mode: ${isProduction ? 'production' : 'development'}, Public port: ${PORT}, Admin port: ${ADMIN_PORT}`);

  function adminCorsOrigin(origin, cb) {
    const adminUrl = (process.env.ADMIN_CLIENT_URL || '').replace(/\/$/, '');
    const devOrigins = [
      'http://localhost:3002',
      'http://127.0.0.1:3002',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    ];
    if (!origin) return cb(null, true);
    if (devOrigins.includes(origin)) return cb(null, true);
    if (adminUrl && origin === adminUrl) return cb(null, true);
    return cb(null, false);
  }

  const app = express();
  if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
  }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(sessionMiddleware);

  registerRoutes(app);
  app.use('/api/playback', playbackRouter);

  // Root route - helpful message in development
  if (!isProduction) {
    app.get('/', (req, res) => {
      res.send(`
        <html>
          <head>
            <title>Spotify Queue API</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background: #f5f5f5;
                color: #212121;
              }
              .container {
                text-align: center;
                padding: 40px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                max-width: 500px;
              }
              h1 { margin-top: 0; }
              code {
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: monospace;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Spotify Queue API</h1>
              <p>This is the backend API server running on port ${PORT}.</p>
              <p>In development, access the frontend at:</p>
              <p><code>http://localhost:3000</code></p>
              <p>API endpoints are available at <code>/api/*</code></p>
            </div>
          </body>
        </html>
      `);
    });
  }

  // Serve static files in production only
  if (isProduction) {
    app.use(express.static(path.join(__dirname, '../client/build')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../client/build/index.html'));
    });
  }

  // Start public server
  const publicServer = app.listen(PORT, () => {
    console.log(`Public server running on port ${PORT}`);
  });
  publicServer.on('error', (err) => {
    console.error(`Public server failed to bind port ${PORT}:`, err.message);
    process.exit(1);
  });

  // Start admin server
  const adminApp = express();
  if (isProduction) {
    adminApp.set('trust proxy', 1);
  }

  adminApp.get('/healthz', (req, res) => res.json({ ok: true }));

  adminApp.use(cors({
    origin: adminCorsOrigin,
    credentials: true
  }));
  adminApp.use(express.json());
  adminApp.use(cookieParser());
  adminApp.use(sessionMiddleware);

  registerRoutes(adminApp);

  // Root route - helpful message in development
  if (!isProduction) {
    adminApp.get('/', (req, res) => {
      res.send(`
        <html>
          <head>
            <title>Spotify Queue Admin API</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background: #f5f5f5;
                color: #212121;
              }
              .container {
                text-align: center;
                padding: 40px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                max-width: 500px;
              }
              h1 { margin-top: 0; }
              code {
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: monospace;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Spotify Queue Admin API</h1>
              <p>This is the admin backend API server running on port ${ADMIN_PORT}.</p>
              <p>In development, access the admin panel at:</p>
              <p><code>http://localhost:3002</code></p>
              <p>API endpoints are available at <code>/api/*</code></p>
            </div>
          </body>
        </html>
      `);
    });
  }

  // Serve admin panel static files in production only
  if (isProduction) {
    adminApp.get('/', (req, res) => res.redirect('/admin'));
    adminApp.use('/admin', express.static(path.join(__dirname, '../admin/build'), { index: false }));
    adminApp.get('/admin', (req, res) => {
      res.sendFile(path.join(__dirname, '../admin/build/index.html'));
    });
    adminApp.get('/admin/*', (req, res) => {
      res.sendFile(path.join(__dirname, '../admin/build/index.html'));
    });
  }

  const adminHttpServer = adminApp.listen(ADMIN_PORT, () => {
    console.log(`Admin server running on port ${ADMIN_PORT}`);
  });
  adminHttpServer.on('error', (err) => {
    console.error(`Admin server failed to bind port ${ADMIN_PORT}:`, err.message);
    process.exit(1);
  });
}
