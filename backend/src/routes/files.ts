import { Router } from 'express';
import {
  buildTree,
  readFileContent,
  writeFileContent,
  createFile,
  deletePath,
  applyEdit,
} from '../services/fileService';

export const filesRouter = Router();

// GET /api/files/tree  -> full (bounded) project tree
filesRouter.get('/tree', async (_req, res, next) => {
  try {
    res.json(await buildTree());
  } catch (e) {
    next(e);
  }
});

// GET /api/files/file?path=...  -> { content, path }
filesRouter.get('/file', async (req, res, next) => {
  try {
    const p = String(req.query.path ?? '');
    if (!p) return res.status(400).json({ error: 'path query param is required' });
    res.json(await readFileContent(p));
  } catch (e) {
    next(e);
  }
});

// POST /api/files/file/save  { path, content }
filesRouter.post('/file/save', async (req, res, next) => {
  try {
    const { path: p, content } = req.body ?? {};
    if (typeof p !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'path and content are required' });
    }
    await writeFileContent(p, content);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/files/file/create  { path, content? }
filesRouter.post('/file/create', async (req, res, next) => {
  try {
    const { path: p, content } = req.body ?? {};
    if (typeof p !== 'string') return res.status(400).json({ error: 'path is required' });
    await createFile(p, typeof content === 'string' ? content : '');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/files/file/delete  { path }
filesRouter.post('/file/delete', async (req, res, next) => {
  try {
    const { path: p } = req.body ?? {};
    if (typeof p !== 'string') return res.status(400).json({ error: 'path is required' });
    await deletePath(p);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/files/apply  — apply an AI-proposed edit
//   edit:   { path, type:'edit', hunks:[{search,replace}] }
//   create: { path, type:'create', content }
filesRouter.post('/apply', async (req, res, next) => {
  try {
    const { path: p, type, hunks, content } = req.body ?? {};
    if (typeof p !== 'string') return res.status(400).json({ error: 'path is required' });

    if (type === 'create') {
      await writeFileContent(p, typeof content === 'string' ? content : '');
      const r = await readFileContent(p);
      return res.json({ ok: true, content: r.content });
    }

    if (!Array.isArray(hunks)) {
      return res.status(400).json({ error: 'hunks array is required for an edit' });
    }
    const newContent = await applyEdit(p, hunks);
    res.json({ ok: true, content: newContent });
  } catch (e) {
    next(e);
  }
});
