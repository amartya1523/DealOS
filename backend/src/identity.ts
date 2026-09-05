import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from './db.js';

export const signupSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();

export async function createPendingAccount(input: z.infer<typeof signupSchema>) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  // Empty update preserves existing accounts and produces the same public response.
  await db.user.upsert({ where: { email: input.email }, update: {}, create: {
    email: input.email, name: input.displayName, passwordHash, status: 'PENDING', role: 'REP',
  } });
}
