import { Router } from 'express';
import { getAuthStatus, antLogin, antLogout } from '../services/auth';

export const authRouter = Router();

// GET /api/auth/status -> { method, hasAuth, antInstalled }
authRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await getAuthStatus());
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login -> runs `ant auth login` (opens the browser); { ok, error? }
authRouter.post('/login', async (_req, res, next) => {
  try {
    const r = await antLogin();
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', async (_req, res, next) => {
  try {
    res.json(await antLogout());
  } catch (e) {
    next(e);
  }
});
