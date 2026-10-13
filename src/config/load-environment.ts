import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import {
  environmentOptions,
  validateEnvironment,
  runtimeEnvironment,
} from './environment';

// This module must be imported before Prisma: Prisma 6 loads .env on import.
// Capture and validate the intended configuration before that side effect.
function loadEnvironment() {
  const mode = runtimeEnvironment();
  const options = environmentOptions();
  let file: Record<string, string> = {};
  if (!options.ignoreEnvFile) {
    try {
      for (const relative of [...options.envFilePath].reverse()) {
        const path = resolve(process.cwd(), relative);
        if (existsSync(path)) file = { ...file, ...parse(readFileSync(path)) };
      }
    } catch {
      throw new Error('Unable to read environment configuration');
    }
  }
  const validated = validateEnvironment({ ...file, ...process.env }, mode);
  process.env.NODE_ENV = validated.NODE_ENV;
  process.env.PORT = String(validated.PORT);
  process.env.DATABASE_URL = validated.DATABASE_URL;
  return validated;
}

const validated = loadEnvironment();

export const appConfigOptions = {
  isGlobal: true,
  cache: true,
  ignoreEnvFile: true,
  skipProcessEnv: true,
  validate: () => validated,
};
