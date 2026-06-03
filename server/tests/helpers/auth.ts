import request from 'supertest';
import type { Express } from 'express';
import { TEST_ADMIN_PASSWORD } from './testApp.js';

/** Log in as admin (password from createTestApp config) and return an agent with the cookie. */
export async function loginAdmin(app: Express, password = TEST_ADMIN_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/admin/login').send({ password });
  if (res.status !== 200) {
    throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}
