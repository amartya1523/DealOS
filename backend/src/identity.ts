import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { db } from './db.js';

const googleClient = new OAuth2Client();

export const signupSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
}).strict();

export const googleSignupSchema = z.object({
  credential: z.string().trim().min(1).max(8192),
  organizationName: z.string().trim().min(2).max(120),
}).strict();

export type GoogleSignupProfile = {
  subject: string;
  displayName: string;
  email: string;
};

export async function createOrganizationAdmin(input: z.infer<typeof signupSchema>) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) return null;
  return db.organization.create({ data: {
    name: input.organizationName,
    users: { create: {
      email: input.email,
      name: input.displayName,
      passwordHash,
      status: 'ACTIVE',
      role: 'ADMIN',
      moduleAccess: [],
    } },
  }, include: { users: true } });
}

export async function verifyGoogleSignupCredential(credential: string, clientId: string): Promise<GoogleSignupProfile> {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error('Google did not return a verified email address.');
  }
  return {
    subject: payload.sub,
    displayName: payload.name?.trim() || payload.email.split('@')[0]!,
    email: payload.email.trim().toLowerCase(),
  };
}

export async function createGoogleOrganizationAdmin(profile: GoogleSignupProfile, organizationName: string) {
  const existing = await db.user.findUnique({ where: { email: profile.email } });
  if (existing) return null;
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  return db.organization.create({ data: {
    name: organizationName,
    users: { create: {
      email: profile.email,
      name: profile.displayName,
      passwordHash,
      googleSubject: profile.subject,
      status: 'ACTIVE',
      role: 'ADMIN',
      moduleAccess: [],
    } },
  }, include: { users: true } });
}
