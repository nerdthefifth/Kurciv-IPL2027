import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './api';
import { sessionMiddleware } from './auth';
import { openDb } from './db';
import { CareerStore } from './store';

export function createApp(dbFile?: string) {
  const db = openDb(dbFile);
  const store = new CareerStore(db);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use(sessionMiddleware(db));
  app.use('/api', apiRouter(db, store));
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return { app, db, store };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  const { app } = createApp();
  app.listen(port, () => console.log(`Kurciv server on http://localhost:${port}`));
}
