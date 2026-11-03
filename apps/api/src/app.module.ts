import { Module, ValidationPipe } from '@nestjs/common'
import { APP_PIPE } from '@nestjs/core'
import { AuthModule } from './auth/auth.module.js'
import { FilesModule } from './files/files.module.js'
import { MeetingsModule } from './meetings/meetings.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { ProfileModule } from './profile/profile.module.js'
import { UsersModule } from './users/users.module.js'

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, MeetingsModule, FilesModule, ProfileModule],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
