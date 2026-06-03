import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeUploadMiddleware } from '../../src/middleware/upload.js';
import { makeJpegBuffer } from '../helpers/fixtures.js';

function appWith(maxBytes: number) {
  const app = express();
  const upload = makeUploadMiddleware(maxBytes);
  app.post('/u', upload, (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    res.json({
      count: files.length,
      uploaderName: req.body.uploaderName,
      deviceId: req.body.deviceId,
      mimetypes: files.map((f) => f.mimetype),
      sizes: files.map((f) => f.size),
    });
  });
  // error handler to surface multer errors as 413/400
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
  });
  return app;
}

describe('upload middleware', () => {
  it('accepts multiple image files and text fields', async () => {
    const app = appWith(5 * 1024 * 1024);
    const jpeg = await makeJpegBuffer(100, 100);
    const res = await request(app)
      .post('/u')
      .field('uploaderName', 'Alice')
      .field('deviceId', 'dev-123')
      .attach('files', jpeg, 'a.jpg')
      .attach('files', jpeg, 'b.jpg');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.uploaderName).toBe('Alice');
    expect(res.body.deviceId).toBe('dev-123');
    expect(res.body.mimetypes[0]).toBe('image/jpeg');
  });

  it('rejects a non image/video mimetype', async () => {
    const app = appWith(5 * 1024 * 1024);
    const res = await request(app)
      .post('/u')
      .attach('files', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('rejects a file larger than the per-file cap', async () => {
    const app = appWith(1024); // 1KB cap
    const jpeg = await makeJpegBuffer(400, 400); // > 1KB
    const res = await request(app).post('/u').attach('files', jpeg, 'big.jpg');
    expect(res.status).toBe(413);
  });
});
