import { Body, Controller, Patch, Req, UseGuards } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { type AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { UpdateProfileCommand } from './commands/update-profile.command.js'
import { UpdateProfileDto } from './dto.js'

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly commandBus: CommandBus) {}

  @Patch()
  update(@Req() req: AuthenticatedRequest, @Body() { name }: UpdateProfileDto) {
    return this.commandBus.execute(new UpdateProfileCommand(req.userId, name))
  }
}
