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
import { PublicUserDto, UpdateProfileDto } from './dto.js'

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
      'Пользователь определяется по токену. Имя обрезается по краям пробелов, не длиннее 100 символов, без управляющих символов и с хотя бы одной буквой или цифрой. Актуальный профиль читается через GET /auth/me.',
  })
  @ApiOkResponse({
    type: PublicUserDto,
    description: 'Обновлённый пользователь (без passwordHash)',
  })
  @ApiBadRequestResponse({
    description:
      'Имя пустое, длиннее 100 символов, содержит управляющие символы или не содержит ни буквы, ни цифры',
  })
  @ApiUnauthorizedResponse({
    description: 'Нет токена, токен недействителен или пользователь удалён',
  })
  update(@Req() req: AuthenticatedRequest, @Body() { name }: UpdateProfileDto) {
    return this.commandBus.execute(new UpdateProfileCommand(req.userId, name))
  }
}
