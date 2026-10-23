import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module';
import { PasswordService } from '../auth/password.service';
import { DemoService } from './demo.service';

@Module({ imports: [InfraModule], providers: [PasswordService, DemoService] })
class DemoCliModule {}

/** `node dist/modules/demo/reset-cli.js` - provisions the demo and (re)loads the fictional data, then exits. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(DemoCliModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    await app.get(DemoService).reset();
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
