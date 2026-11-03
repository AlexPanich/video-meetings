import { Body, Controller, Patch, Req, UseGuards } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
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
  @ApiOperation({
    summary: 'Изменить своё имя',
    description:
      'Пользователь определяется по токену. Имя обрезается по краям пробелов. Актуальный профиль читается через GET /auth/me.',
  })
  @ApiOkResponse({ description: 'Обновлённый пользователь (без passwordHash)' })
  @ApiBadRequestResponse({ description: 'Имя пустое или состоит из пробелов' })
  @ApiUnauthorizedResponse({
    description: 'Нет токена, токен недействителен или пользователь удалён',
  })
  update(@Req() req: AuthenticatedRequest, @Body() { name }: UpdateProfileDto) {
    return this.commandBus.execute(new UpdateProfileCommand(req.userId, name))
  }
}
