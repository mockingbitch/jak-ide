import path from 'node:path';
import { Router } from 'express';
import { PROJECT_ROOT } from '../config';
import { getRecents, openProject, browse } from '../services/projects';

export const projectsRouter = Router();

// GET /api/projects  -> { current, name, recents }
projectsRouter.get('/', (_req, res) => {
  res.json({
    current: PROJECT_ROOT,
    name: path.basename(PROJECT_ROOT) || PROJECT_ROOT,
    recents: getRecents(),
  });
});

// POST /api/projects/open  { path }  -> switch the active project folder
projectsRouter.post('/open', (req, res) => {
  try {
    const { path: dir } = req.body ?? {};
    if (typeof dir !== 'string' || !dir.trim()) {
      return res.status(400).json({ error: 'path is required' });
    }
    const r = openProject(dir);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// GET /api/projects/browse?path=...  -> list sub-directories for the folder picker
projectsRouter.get('/browse', (req, res) => {
  try {
    const p = typeof req.query.path === 'string' ? req.query.path : undefined;
    res.json(browse(p));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
