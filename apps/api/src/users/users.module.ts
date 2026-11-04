import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { ClearUserAvatarHandler } from './commands/clear-user-avatar.handler.js'
import { ChangeUserPasswordHandler } from './commands/change-user-password.handler.js'
import { CreateUserHandler } from './commands/create-user.handler.js'
import { SetUserAvatarHandler } from './commands/set-user-avatar.handler.js'
import { UpdateUserNameHandler } from './commands/update-user-name.handler.js'
import { FindUserByEmailHandler } from './queries/find-user-by-email.handler.js'
import { FindUserByIdHandler } from './queries/find-user-by-id.handler.js'

@Module({
  imports: [CqrsModule],
  providers: [
    CreateUserHandler,
    ChangeUserPasswordHandler,
    UpdateUserNameHandler,
    SetUserAvatarHandler,
    ClearUserAvatarHandler,
    FindUserByEmailHandler,
    FindUserByIdHandler,
  ],
})
export class UsersModule {}
