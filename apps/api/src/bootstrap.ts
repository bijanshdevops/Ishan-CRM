import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadConfig } from './config';

export async function createApp(): Promise<NestFastifyApplication> {
  const config = loadConfig();
  // proxy-addr (behind Fastify) also accepts a hop count, which the type definition omits.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: (config.TRUST_PROXY ?? true) as never }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  await app.register(helmet as never, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  });
  // Nest already parses form bodies, which RFC 8058 one-click unsubscribe posts (the body is ignored).
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });

  if (config.NODE_ENV !== 'production') setupOpenApi(app);
  return app;
}

function setupOpenApi(app: INestApplication): void {
  const doc = new DocumentBuilder().setTitle('Ishan CRM API').setVersion('1').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
