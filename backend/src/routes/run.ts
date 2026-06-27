import { Router } from 'express';
import { runCommand } from '../services/commandRunner';

export const runRouter = Router();

// POST /api/run-command  { command }  -> { ok, stdout, stderr, exitCode, error? }
runRouter.post('/run-command', async (req, res, next) => {
  try {
    const { command } = req.body ?? {};
    if (typeof command !== 'string') return res.status(400).json({ error: 'command is required' });
    res.json(await runCommand(command));
  } catch (e) {
    next(e);
  }
});
