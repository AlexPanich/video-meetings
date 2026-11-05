import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger'
import { ThrottlerGuard } from '@nestjs/throttler'
import { LoginUserCommand } from './commands/login-user.command.js'
import { LogoutUserCommand } from './commands/logout-user.command.js'
import { RegisterUserCommand } from './commands/register-user.command.js'
import { LoginDto, RegisterDto } from './dto.js'
import { type AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard.js'
import { GetCurrentUserQuery } from './queries/get-current-user.query.js'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: 'Превышен лимит запросов (по IP и по email)' })
  register(@Body() { email, password, name }: RegisterDto) {
    return this.commandBus.execute(new RegisterUserCommand(email, password, name))
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: 'Превышен лимит запросов (по IP и по email)' })
  login(@Body() { email, password }: LoginDto) {
    return this.commandBus.execute(new LoginUserCommand(email, password))
  }

  // Завершает все сессии пользователя (tokenVersion растёт, прежние токены получают 401)
  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  logout(@Req() req: AuthenticatedRequest) {
    return this.commandBus.execute(new LogoutUserCommand(req.userId))
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return this.queryBus.execute(new GetCurrentUserQuery(req.userId))
  }
}
