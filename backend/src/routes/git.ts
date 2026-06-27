import path from 'node:path';
import fs from 'fs-extra';
import { Router } from 'express';
import * as git from '../services/gitService';

export const gitRouter = Router();

// Wrap an async handler so GitError -> 400 with its message (others -> 500).
function h(fn: (req: any, res: any) => Promise<void>) {
  return (req: any, res: any, next: any) => {
    fn(req, res).catch((e) => {
      if (e instanceof git.GitError) return res.status(400).json({ error: e.message, code: e.code });
      next(e);
    });
  };
}

// --- state ---------------------------------------------------------------
gitRouter.get('/status', h(async (_req, res) => res.json(await git.status())));

gitRouter.get('/branches', h(async (_req, res) => res.json(await git.branches())));

gitRouter.get('/log', h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 500);
  const skip = Number(req.query.skip) || 0;
  const file = typeof req.query.file === 'string' ? req.query.file : undefined;
  res.json(await git.log({ limit, skip, file }));
}));

gitRouter.get('/diff', h(async (req, res) => {
  const path = String(req.query.path ?? '');
  if (!path) return res.status(400).json({ error: 'path is required' });
  const mode = req.query.mode === 'staged' ? 'staged' : 'working';
  res.json(await git.diffFile(path, mode));
}));

gitRouter.get('/remotes', h(async (_req, res) => res.json(await git.remotes())));

gitRouter.get('/blame', h(async (req, res) => {
  const p = String(req.query.path ?? '');
  if (!p) return res.status(400).json({ error: 'path is required' });
  res.json(await git.blame(p));
}));

gitRouter.get('/commit-diff', h(async (req, res) => {
  const hash = String(req.query.hash ?? '');
  const p = String(req.query.path ?? '');
  if (!hash || !p) return res.status(400).json({ error: 'hash and path are required' });
  res.json(await git.commitDiff(hash, p));
}));

gitRouter.get('/conflict', h(async (req, res) => {
  const p = String(req.query.path ?? '');
  if (!p) return res.status(400).json({ error: 'path is required' });
  res.json(await git.conflict(p));
}));

// --- repo lifecycle ------------------------------------------------------
gitRouter.post('/init', h(async (_req, res) => {
  await git.init();
  res.json({ ok: true });
}));

gitRouter.post('/clone', h(async (req, res) => {
  const { url, parent, name } = req.body ?? {};
  if (!url || !parent) return res.status(400).json({ error: 'url and parent are required' });
  const dest = await git.clone(url, parent, name);
  res.json({ ok: true, path: dest });
}));

// SSE clone with live progress: GET /api/git/clone-stream?url=&parent=&name=
gitRouter.get('/clone-stream', (req, res) => {
  const url = String(req.query.url ?? '');
  const parent = String(req.query.parent ?? '');
  const name = typeof req.query.name === 'string' && req.query.name ? req.query.name : undefined;
  if (!url || !parent) {
    res.status(400).json({ error: 'url and parent are required' });
    return;
  }
  const target = path.join(path.resolve(parent), name || git.repoNameFromUrl(url));
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    fs.ensureDirSync(path.dirname(target));
  } catch (e) {
    send({ type: 'error', error: (e as Error).message });
    return res.end();
  }

  send({ type: 'start', target });
  const child = git.spawnGit(['clone', '--progress', '--', url, target], path.dirname(target));
  const onText = (d: Buffer) => send({ type: 'progress', text: d.toString() });
  child.stderr.on('data', onText); // git clone progress goes to stderr
  child.stdout.on('data', onText);
  child.on('error', (e) => {
    send({ type: 'error', error: e.message });
    res.end();
  });
  child.on('close', (code) => {
    if (code === 0) send({ type: 'done', path: target });
    else send({ type: 'error', error: `git clone exited ${code}` });
    res.end();
  });
  req.on('close', () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  });
});

// --- staging / commit ----------------------------------------------------
gitRouter.post('/stage', h(async (req, res) => {
  const { paths, all } = req.body ?? {};
  if (all) await git.stageAll();
  else await git.stage(Array.isArray(paths) ? paths : []);
  res.json({ ok: true });
}));

gitRouter.post('/unstage', h(async (req, res) => {
  const { paths, all } = req.body ?? {};
  if (all) await git.unstageAll();
  else await git.unstage(Array.isArray(paths) ? paths : []);
  res.json({ ok: true });
}));

gitRouter.post('/discard', h(async (req, res) => {
  const { paths } = req.body ?? {};
  await git.discard(Array.isArray(paths) ? paths : []);
  res.json({ ok: true });
}));

gitRouter.post('/resolve', h(async (req, res) => {
  const { path: p, side } = req.body ?? {};
  if (!p || (side !== 'ours' && side !== 'theirs')) {
    return res.status(400).json({ error: 'path and side (ours|theirs) are required' });
  }
  await git.resolve(p, side);
  res.json({ ok: true });
}));

gitRouter.post('/commit', h(async (req, res) => {
  const { message, amend, paths } = req.body ?? {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'commit message is required' });
  const out =
    Array.isArray(paths) && paths.length
      ? await git.commitFiles(String(message), paths)
      : await git.commit(String(message), Boolean(amend));
  res.json({ ok: true, output: out });
}));

// --- branches ------------------------------------------------------------
gitRouter.post('/branch', h(async (req, res) => {
  const { name, checkout, startPoint } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  await git.createBranch(name, checkout !== false, typeof startPoint === 'string' ? startPoint : undefined);
  res.json({ ok: true });
}));

gitRouter.post('/checkout', h(async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  await git.checkout(name);
  res.json({ ok: true });
}));

gitRouter.post('/checkout-remote', h(async (req, res) => {
  const { remote } = req.body ?? {};
  if (!remote) return res.status(400).json({ error: 'remote is required' });
  await git.checkoutRemote(remote);
  res.json({ ok: true });
}));

gitRouter.post('/branch/rename', h(async (req, res) => {
  const { oldName, newName } = req.body ?? {};
  if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' });
  await git.renameBranch(oldName, newName);
  res.json({ ok: true });
}));

gitRouter.post('/branch/delete', h(async (req, res) => {
  const { name, force } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  await git.deleteBranch(name, Boolean(force));
  res.json({ ok: true });
}));

gitRouter.post('/merge', h(async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const out = await git.merge(name);
  res.json({ ok: true, output: out });
}));

// --- remote --------------------------------------------------------------
gitRouter.post('/fetch', h(async (_req, res) => res.json({ ok: true, output: await git.fetch() })));
gitRouter.post('/pull', h(async (_req, res) => res.json({ ok: true, output: await git.pull() })));
gitRouter.post('/push', h(async (req, res) => {
  const out = await git.push(Boolean(req.body?.setUpstream));
  res.json({ ok: true, output: out });
}));
