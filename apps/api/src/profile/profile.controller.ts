import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger'
import { type AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js'
import { DeleteAvatarCommand } from './commands/delete-avatar.command.js'
import { GetAvatarQuery } from './queries/get-avatar.query.js'
import { UploadAvatarCommand } from './commands/upload-avatar.command.js'
import { UpdateProfileCommand } from './commands/update-profile.command.js'
import { PublicUserDto, UpdateProfileDto } from './dto.js'

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

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

  @Put('avatar')
  @ApiOperation({
    summary: 'Загрузить или заменить свой аватар',
    description:
      'multipart/form-data, один файл в поле `file`: JPEG, PNG или WebP до 5 МБ. Формат определяется по сигнатуре файла, а не по заголовку клиента. При ошибке текущий аватар не меняется; прежний файл удаляется после успешной замены.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({
    type: PublicUserDto,
    description: 'Обновлённый пользователь (без passwordHash)',
  })
  @ApiBadRequestResponse({ description: 'Файл не передан или тело multipart некорректно' })
  @ApiPayloadTooLargeResponse({ description: 'Файл больше 5 МБ' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Файл не JPEG, PNG и не WebP' })
  @ApiUnauthorizedResponse({
    description: 'Нет токена, токен недействителен или пользователь удалён',
  })
  uploadAvatar(@Req() req: AuthenticatedRequest) {
    return this.commandBus.execute(new UploadAvatarCommand(req.userId, req))
  }

  @Get('avatar')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Получить свой аватар',
    description: 'Отдаётся только аватар пользователя из токена; Content-Type берётся из БД.',
  })
  @ApiOkResponse({
    description: 'Изображение (image/jpeg, image/png или image/webp)',
    content: { 'image/*': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiNotFoundResponse({ description: 'Аватар не загружен' })
  @ApiUnauthorizedResponse({
    description: 'Нет токена, токен недействителен или пользователь удалён',
  })
  getAvatar(@Req() req: AuthenticatedRequest) {
    return this.queryBus.execute(new GetAvatarQuery(req.userId))
  }

  @Delete('avatar')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить свой аватар: запись в БД и файл на диске' })
  @ApiNoContentResponse({ description: 'Аватар удалён' })
  @ApiNotFoundResponse({ description: 'Аватар не загружен' })
  @ApiUnauthorizedResponse({
    description: 'Нет токена, токен недействителен или пользователь удалён',
  })
  deleteAvatar(@Req() req: AuthenticatedRequest) {
    return this.commandBus.execute(new DeleteAvatarCommand(req.userId))
  }
}
