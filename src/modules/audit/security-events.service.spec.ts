import { Logger } from '@nestjs/common';
import { SecurityEvents } from './security-events.service';

describe('Identity security events', () => {
  it('logs only a fixed event name and user ID', () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    try {
      new SecurityEvents().record('account.registered', 'test-user-id');
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({ event: 'account.registered', userId: 'test-user-id' }),
      );
    } finally {
      log.mockRestore();
    }
  });
});
