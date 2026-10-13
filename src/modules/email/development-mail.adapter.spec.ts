import { mkdtemp, readdir, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevelopmentMailAdapter } from './development-mail.adapter';

describe('Private local development outbox', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kirana-mail-'));
  });
  afterEach(async () => {
    for (const name of await readdir(directory))
      await unlink(join(directory, name));
    await rmdir(directory);
  });
  it('writes a local email rather than logging its contents', async () => {
    const adapter = new DevelopmentMailAdapter('development', directory);
    const message = {
      to: 'owner@example.com',
      subject: 'Verify email',
      text: 'one-time-link-fixture',
    };
    await expect(adapter.send(message)).resolves.toBe('development-outbox');
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(directory, files[0]), 'utf8')),
    ).toEqual(message);
  });
  it('refuses to write emails in production', async () => {
    const adapter = new DevelopmentMailAdapter('production', directory);
    await expect(
      adapter.send({
        to: 'owner@example.com',
        subject: 'Verify',
        text: 'test-link',
      }),
    ).rejects.toThrow('disabled');
    expect(await readdir(directory)).toHaveLength(0);
  });
});
