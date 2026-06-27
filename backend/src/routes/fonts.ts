import { Router } from 'express';
import { listFonts } from '../services/fonts';

export const fontsRouter = Router();

// GET /api/fonts -> { fonts: string[], source: 'fontconfig' | 'fallback' }
fontsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listFonts());
  } catch (e) {
    next(e);
  }
});
