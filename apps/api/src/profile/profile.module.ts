import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { AuthModule } from '../auth/auth.module.js'
import { UpdateProfileHandler } from './commands/update-profile.handler.js'
import { ProfileController } from './profile.controller.js'

@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [ProfileController],
  providers: [UpdateProfileHandler],
})
export class ProfileModule {}
