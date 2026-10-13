import {
  existsSync,
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Startup environment selection before Prisma imports', () => {
  let directory: string;
  let original: NodeJS.ProcessEnv;

  beforeEach(() => {
    original = { ...process.env };
    directory = mkdtempSync(join(tmpdir(), 'kirana-config-'));
    jest.spyOn(process, 'cwd').mockReturnValue(directory);
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_TEST;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
    for (const name of ['.env', '.env.development', '.env.test']) {
      const path = join(directory, name);
      if (existsSync(path)) unlinkSync(path);
    }
    rmdirSync(directory);
  });

  function load() {
    let options: typeof import('./load-environment').appConfigOptions;
    jest.isolateModules(() => {
      options =
        jest.requireActual<typeof import('./load-environment')>(
          './load-environment',
        ).appConfigOptions;
    });
    return options!;
  }

  it('production fails with a missing DB even when .env contains a valid DB', () => {
    process.env.NODE_ENV = 'production';
    writeFileSync(
      join(directory, '.env'),
      'DATABASE_URL=postgresql://app:placeholder@db.example.invalid/kirana_identity\n',
    );
    expect(() => load()).toThrow('Invalid configuration: DATABASE_URL');
  });

  it('development-specific files override .env and the process overrides files', () => {
    process.env.NODE_ENV = 'development';
    writeFileSync(
      join(directory, '.env'),
      'PORT=3001\nDATABASE_URL=postgresql://dev:placeholder@localhost:5433/kirana_identity\n',
    );
    writeFileSync(join(directory, '.env.development'), 'PORT=3002\n');
    expect(load().validate().PORT).toBe(3002);
    process.env.PORT = '3003';
    expect(load().validate().PORT).toBe(3003);
  });

  it('uses only .env.test in test mode and snapshots validated values', () => {
    process.env.NODE_ENV = 'test';
    writeFileSync(
      join(directory, '.env'),
      'DATABASE_URL=postgresql://dev:placeholder@localhost:5433/kirana_identity\n',
    );
    writeFileSync(
      join(directory, '.env.test'),
      'DATABASE_URL_TEST=postgresql://kirana_test:placeholder@127.0.0.1:5434/kirana_identity_test?schema=public\n',
    );
    const options = load();
    expect(options.validate().DATABASE_URL).toContain(
      ':5434/kirana_identity_test',
    );
    process.env.DATABASE_URL = 'private-invalid-value';
    expect(options.validate().DATABASE_URL).toContain(
      ':5434/kirana_identity_test',
    );
    expect(options.skipProcessEnv).toBe(true);
  });
});
