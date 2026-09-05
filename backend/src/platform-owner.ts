import crypto from 'node:crypto';

export type PlatformOwnerCredentials = { loginId: string; password: string };

export function readPlatformOwnerCredentials(env: NodeJS.ProcessEnv = process.env): PlatformOwnerCredentials | null {
  const loginId = env.PLATFORM_OWNER_LOGIN_ID?.trim();
  const password = env.PLATFORM_OWNER_PASSWORD;
  if (!loginId || !password || password.length < 16) return null;
  return { loginId, password };
}

export function platformOwnerCredentialsMatch(input: { loginId: string; password: string }, expected: PlatformOwnerCredentials): boolean {
  const suppliedId = crypto.createHash('sha256').update(input.loginId).digest();
  const expectedId = crypto.createHash('sha256').update(expected.loginId).digest();
  const suppliedPassword = crypto.createHash('sha256').update(input.password).digest();
  const expectedPassword = crypto.createHash('sha256').update(expected.password).digest();
  return crypto.timingSafeEqual(suppliedId, expectedId) && crypto.timingSafeEqual(suppliedPassword, expectedPassword);
}

type Attempt = { failures: number; resetAt: number };
const attempts = new Map<string, Attempt>();
const windowMs = 15 * 60 * 1000;
const maximumFailures = 5;

export function platformLoginAllowed(key: string, now = Date.now()): boolean {
  const attempt = attempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    attempts.delete(key);
    return true;
  }
  return attempt.failures < maximumFailures;
}

export function recordPlatformLoginFailure(key: string, now = Date.now()) {
  const current = attempts.get(key);
  attempts.set(key, !current || current.resetAt <= now ? { failures: 1, resetAt: now + windowMs } : { ...current, failures: current.failures + 1 });
}

export function clearPlatformLoginFailures(key: string) {
  attempts.delete(key);
}
