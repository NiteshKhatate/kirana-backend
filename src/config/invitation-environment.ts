export interface InvitationConfig {
  ttlSeconds: number;
}
export function validateInvitationEnvironment(
  input: Record<string, unknown>,
): InvitationConfig {
  const raw = input.INVITATION_TTL_SECONDS ?? 604800;
  const ttlSeconds =
    typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 604800)
    throw new Error('Invalid configuration: INVITATION_TTL_SECONDS');
  return { ttlSeconds };
}
