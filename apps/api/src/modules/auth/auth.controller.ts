import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthSession, User } from '@chatofy/types';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { AuthService } from './auth.service';
import {
  AuthSessionDto,
  LoginRequestDto,
  RegisterRequestDto,
  UserDto,
} from './dto/auth.dto';

/**
 * Password identity: create an account, exchange credentials for an access
 * token, and read back who a token belongs to.
 *
 * Register and login are unauthenticated by necessity and each spends a full
 * argon2 hash — 64 MiB on the libuv threadpool, which this process shares with
 * the translate pipeline's file and crypto work. The per-route throttles below
 * are what keeps an attacker's chosen request rate from deciding how much of
 * that pool auth gets.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an account and return a session' })
  @ApiEnvelopeResponse(AuthSessionDto, { status: 201 })
  register(@Body() body: RegisterRequestDto): Promise<AuthSession> {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange email and password for a session' })
  @ApiEnvelopeResponse(AuthSessionDto)
  login(@Body() body: LoginRequestDto): Promise<AuthSession> {
    return this.auth.login(body);
  }

  /**
   * Guarded, unlike the two above. The web session shell calls this to hydrate
   * a session and to tell an auth failure apart from a network fault, so it must
   * answer 401 for a token that is missing, expired or forged.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The authenticated caller's profile" })
  @ApiEnvelopeResponse(UserDto)
  me(@Req() req: Request): Promise<User> {
    return this.auth.findMe(req.auth!.userId);
  }
}
