import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { LoginUserCommand } from './commands/login-user.command.js'
import { RegisterUserCommand } from './commands/register-user.command.js'
import { LoginDto, RegisterDto } from './dto.js'
import { type AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard.js'
import { GetCurrentUserQuery } from './queries/get-current-user.query.js'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('register')
  register(@Body() { email, password, name }: RegisterDto) {
    return this.commandBus.execute(new RegisterUserCommand(email, password, name))
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() { email, password }: LoginDto) {
    return this.commandBus.execute(new LoginUserCommand(email, password))
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return this.queryBus.execute(new GetCurrentUserQuery(req.userId))
  }
}
