import { validateInvitationEnvironment } from './invitation-environment';
describe('Invitation configuration', () => {
  it('defaults to seven days and accepts bounded TTLs', () => {
    expect(validateInvitationEnvironment({})).toEqual({ ttlSeconds: 604800 });
    expect(
      validateInvitationEnvironment({ INVITATION_TTL_SECONDS: '300' }),
    ).toEqual({ ttlSeconds: 300 });
  });
  it.each([0, 299, 604801, false, 'invalid'])(
    'rejects unsafe TTL %p without exposing values',
    (value) => {
      expect(() =>
        validateInvitationEnvironment({ INVITATION_TTL_SECONDS: value }),
      ).toThrow('Invalid configuration: INVITATION_TTL_SECONDS');
    },
  );
});
