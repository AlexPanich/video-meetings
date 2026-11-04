import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt'
import { UsersModule } from '../users/users.module.js'
import { AuthController } from './auth.controller.js'
import { LoginUserHandler } from './commands/login-user.handler.js'
import { RegisterUserHandler } from './commands/register-user.handler.js'
import { JwtAuthGuard } from './jwt-auth.guard.js'
import { GetCurrentUserHandler } from './queries/get-current-user.handler.js'
import { TokenService } from './token.service.js'

@Module({
  imports: [
    CqrsModule,
    UsersModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET
        if (!secret) throw new Error('JWT_SECRET не задан')
        return {
          secret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: (process.env.JWT_EXPIRES_IN ?? '1h') as JwtSignOptions['expiresIn'],
          },
          verifyOptions: { algorithms: ['HS256'] },
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
