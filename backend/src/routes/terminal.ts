import { Router } from 'express';
import { listShells } from '../services/shells';

export const terminalRouter = Router();

// GET /api/terminal/shells -> { shells: [{name, path}], default }
terminalRouter.get('/shells', (_req, res) => {
  res.json(listShells());
});
