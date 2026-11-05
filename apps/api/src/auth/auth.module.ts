import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { JwtModule } from '@nestjs/jwt'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { LoginUserHandler } from './commands/login-user.handler.js'
import { RegisterUserHandler } from './commands/register-user.handler.js'
import { JwtAuthGuard } from './jwt-auth.guard.js'
import { resolveJwtConfig } from './jwt-config.js'
import { GetCurrentUserHandler } from './queries/get-current-user.handler.js'
import { TokenService } from './token.service.js'

@Module({
  imports: [
    CqrsModule,
    UsersModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const { secret, expiresInSeconds, issuer, audience } = resolveJwtConfig(process.env)
        return {
          secret,
          signOptions: { algorithm: 'HS256', expiresIn: expiresInSeconds, issuer, audience },
          verifyOptions: { algorithms: ['HS256'], issuer, audience },
        }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtAuthGuard,
    TokenService,
    RegisterUserHandler,
    LoginUserHandler,
    GetCurrentUserHandler,
  ],
  exports: [JwtModule, JwtAuthGuard, TokenService],
})
export class AuthModule {}
