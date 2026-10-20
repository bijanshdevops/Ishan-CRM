import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { loadConfig } from './config';
import { InfraModule } from './infra/infra.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { BootstrapModule } from './modules/bootstrap/bootstrap.module';
import { HealthModule } from './modules/health/health.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { TeamsModule } from './modules/teams/teams.module';
import { SalesModule } from './modules/sales/sales.module';
import { UsersModule } from './modules/users/users.module';

const config = loadConfig();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.LOG_LEVEL,
        genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/v1/health') },
      },
    }),
    InfraModule,
    AuditModule,
    AuthModule,
    BootstrapModule,
    HealthModule,
    UsersModule,
    RolesModule,
    TeamsModule,
    CustomersModule,
    SalesModule,
    ActivitiesModule,
    ReportsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
