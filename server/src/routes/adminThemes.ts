import { Router } from 'express';
import { z } from 'zod';
import type { ThemeRepo } from '../db/repositories/themeRepo.js';

const themeTokensSchema = z.object({
  background: z.object({
    type: z.enum(['solid', 'gradient', 'image']),
    value: z.string(),
  }),
  ambient: z.enum(['none', 'bokeh', 'particles', 'glow']),
  frame: z.object({
    style: z.enum(['thin', 'polaroid', 'rounded', 'none']),
    borderColor: z.string(),
    borderWidth: z.number(),
    radius: z.number(),
    shadow: z.boolean(),
  }),
  caption: z.object({
    enabled: z.boolean(),
    bg: z.string(),
    color: z.string(),
  }),
  font: z.string(),
  accent: z.string(),
});

const createSchema = z.object({ name: z.string().trim().min(1), tokens: themeTokensSchema });
const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  tokens: themeTokensSchema.optional(),
});

export function makeAdminThemesRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    res.json(themeRepo.list());
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    res.json(themeRepo.create(parsed.data));
  });

  router.put('/:id', (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const updated = themeRepo.update(req.params.id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const theme = themeRepo.getById(req.params.id);
    if (!theme) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const removed = themeRepo.remove(req.params.id); // false if preset
    if (!removed) {
      res.status(409).json({ error: 'preset_immutable' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
