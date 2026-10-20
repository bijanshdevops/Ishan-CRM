import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config';

/** AES-256-GCM for secrets at rest. Format: base64(iv).base64(tag).base64(ciphertext). */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.ENCRYPTION_KEY, 'base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }

  decrypt(payload: string): string {
    const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
    if (!iv || !tag || !enc) throw new Error('Malformed ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  static sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
