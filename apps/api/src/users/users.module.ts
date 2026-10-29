import { Module } from '@nestjs/common'
import { CqrsModule } from '@nestjs/cqrs'
import { CreateUserHandler } from './commands/create-user.handler.js'
import { FindUserByEmailHandler } from './queries/find-user-by-email.handler.js'
import { FindUserByIdHandler } from './queries/find-user-by-id.handler.js'

@Module({
  imports: [CqrsModule],
  providers: [CreateUserHandler, FindUserByEmailHandler, FindUserByIdHandler],
})
export class UsersModule {}
