import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { AuthModule } from '../auth/auth.module.js'
import { ChangePasswordHandler } from './commands/change-password.handler.js'
import { DeleteAvatarHandler } from './commands/delete-avatar.handler.js'
import { OrphanAvatarsCleaner } from './orphan-avatars.cleaner.js'
import { GetAvatarHandler } from './queries/get-avatar.handler.js'
import { UpdateProfileHandler } from './commands/update-profile.handler.js'
import { UploadAvatarHandler } from './commands/upload-avatar.handler.js'
import { ProfileController } from './profile.controller.js'

@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [ProfileController],
  providers: [
    UpdateProfileHandler,
    ChangePasswordHandler,
    UploadAvatarHandler,
    GetAvatarHandler,
    DeleteAvatarHandler,
    OrphanAvatarsCleaner,
  ],
})
export class ProfileModule {}
