import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, isProd } from './config.js';
import { buildRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './lib/http.js';
import { pool } from './db/client.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (isProd) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'https:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.NODE_ENV === 'test' ? 100_000 : 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } }),
    }),
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    buildRouter(),
  );
  app.use('/api', notFoundHandler);

  // In production the API also serves the built web client.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: isProd ? '1h' : 0 }));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
