import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

@Injectable()
export class PasswordService {
  // Argon2id v19: 64 MiB, three iterations, one lane, 32-byte tag.
  hash(password: string): Promise<string> {
    return hash(password, {
      // The binding declares ambient const enums, incompatible with isolatedModules.
      // Its API values are Argon2id=2 and Version.V0x13=1.
      algorithm: 2,
      version: 1,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
    });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
