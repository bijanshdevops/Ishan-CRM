import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Argon2id with OWASP-recommended minimum parameters (19 MiB, t=2, p=1). */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Burns equivalent CPU time when the account does not exist (login timing parity). */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing-parity');
    await this.verify(await this.dummyHash, password);
  }
}
