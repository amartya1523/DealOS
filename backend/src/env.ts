import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

// `npm --prefix backend ...` does not change Node's working directory. Resolve
// the backend .env from this module so development and compiled starts behave
// the same whether invoked from the repository root or the backend directory.
const backendEnvPath = [
  path.resolve(moduleDirectory, '../.env'),
  path.resolve(moduleDirectory, '../../.env'),
].find(existsSync);

if (backendEnvPath) config({ path: backendEnvPath });
