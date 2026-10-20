import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, OriginGuard, PermissionsGuard } from '../../common/guards';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    PasswordService,
    TotpService,
    CryptoService,
    // Order matters: origin check → authentication → authorization.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PasswordService, SessionService, CryptoService, TotpService],
})
export class AuthModule {}
