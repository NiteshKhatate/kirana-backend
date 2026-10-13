/** Local persistence tests are restricted to the dedicated Docker service. */
export function assertTestDatabaseUrl(value: unknown): string {
  const message =
    'Test database must use the dedicated local kirana_identity_test database on port 5434 as kirana_test';
  if (typeof value !== 'string') throw new Error(message);
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '5434' ||
      url.pathname !== '/kirana_identity_test' ||
      url.username !== 'kirana_test' ||
      !url.password ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => key !== 'schema') ||
      url.searchParams.getAll('schema').length > 1 ||
      (url.searchParams.has('schema') &&
        url.searchParams.get('schema') !== 'public')
    )
      throw new Error(message);
    return value;
  } catch {
    throw new Error(message);
  }
}
