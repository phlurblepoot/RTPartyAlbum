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
    // New layout fields are optional so themes saved before they existed (and the
    // built-in presets) still validate; the client resolves defaults for missing ones.
    position: z.enum(['below', 'above', 'inside', 'bubble']).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    offsetPx: z.number().min(-150).max(150).optional(),
    insideEdge: z.enum(['top', 'bottom']).optional(),
    bubble: z
      .object({
        corner: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
        offsetX: z.number().min(-200).max(200),
        offsetY: z.number().min(-200).max(200),
        width: z.number().min(20).max(400),
        height: z.number().min(16).max(200),
        rotation: z.number().min(-45).max(45),
        radius: z.number().min(0).max(60),
        borderWidth: z.number().min(0).max(20),
        borderColor: z.string(),
      })
      .optional(),
  }),
  font: z.string(),
  accent: z.string(),
});

const createSchema = z.object({ name: z.string().trim().min(1).max(120), tokens: themeTokensSchema });
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
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
    const existing = themeRepo.getById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (existing.isPreset) {
      res.status(409).json({ error: 'preset_not_editable' });
      return;
    }
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
