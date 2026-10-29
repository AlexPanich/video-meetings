import { Module, ValidationPipe } from '@nestjs/common'
import { APP_PIPE } from '@nestjs/core'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { AuthModule } from './auth/auth.module.js'
import { MeetingsModule } from './meetings/meetings.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { UsersModule } from './users/users.module.js'

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, MeetingsModule],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
