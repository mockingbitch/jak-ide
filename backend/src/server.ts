import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { PORT, PROJECT_ROOT, MODEL, HAS_API_KEY } from './config';
import { filesRouter } from './routes/files';
import { runRouter } from './routes/run';
import { aiRouter } from './routes/ai';
import { terminalRouter } from './routes/terminal';
import { authRouter } from './routes/auth';
import { fontsRouter } from './routes/fonts';
import { projectsRouter } from './routes/projects';
import { gitRouter } from './routes/git';
import { recordInitialRoot } from './services/projects';
import { attachTerminal } from './ws/terminal';

export interface ServerOptions {
  /** Port to listen on. Use 0 for an ephemeral port (desktop app). Defaults to config PORT. */
  port?: number;
  /** Directory of the built frontend to serve (desktop/production). Omit in web-dev. */
  staticDir?: string;
}

export function createApp(opts: { staticDir?: string } = {}) {
  recordInitialRoot(); // seed the recents list with the folder we booted into

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      projectRoot: PROJECT_ROOT,
      model: MODEL,
      hasApiKey: HAS_API_KEY,
      desktop: Boolean(opts.staticDir),
    });
  });

  app.use('/api/files', filesRouter);
  app.use('/api', runRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/terminal', terminalRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/fonts', fontsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/git', gitRouter);

  // Serve the built frontend (desktop / production). The dev workflow uses Vite
  // instead, so this only kicks in when a static dir is provided and exists.
  const staticDir = opts.staticDir;
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // SPA fallback for any non-API GET.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // Centralised error handler.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ error: err?.message ?? 'Internal error' });
  });

  return app;
}

/** Create the HTTP server, attach the WebSocket terminal, and start listening. */
export function startServer(opts: ServerOptions = {}): Promise<{ server: http.Server; port: number }> {
  const app = createApp({ staticDir: opts.staticDir ?? process.env.FRONTEND_DIST });
  const server = http.createServer(app);
  attachTerminal(server);

  const desired = opts.port ?? PORT;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(desired, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : desired;
      resolve({ server, port });
    });
  });
}
