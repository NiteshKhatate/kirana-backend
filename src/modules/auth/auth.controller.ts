import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { AuthMessageDto, RegisterResponseDto } from './dto/auth-response.dto';
import { AccessTokenGuard } from './access-token.guard';
import type { AuthenticatedRequest } from './access-token.guard';
import { PublicUserDto } from '../users/public-user';
import { SessionService } from './session.service';
import {
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  SessionResponseDto,
} from './dto/session.dto';

@ApiTags('Authentication')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiResponse({ status: 429, type: ErrorResponseDto })
@UseGuards(AuthRateLimitGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  login(@Body() input: LoginDto) {
    return this.sessions.login(input);
  }

  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  refresh(@Body() input: RefreshDto) {
    return this.sessions.refresh(input.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiResponse({
    status: 204,
    description:
      'Revokes the refresh family, including rotated descendants. Existing access tokens remain valid until expiry.',
  })
  logout(@Body() input: RefreshDto) {
    return this.sessions.logout(input.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    type: AuthMessageDto,
    description:
      'Generic response, including ineligible accounts, cooldown and delivery failure.',
  })
  forgotPassword(@Body() input: ResendVerificationDto) {
    return this.sessions.forgotPassword(input.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AuthMessageDto })
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.sessions.resetPassword(input);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PublicUserDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  me(@Req() request: AuthenticatedRequest): PublicUserDto {
    if (!request.user) throw new UnauthorizedException();
    return request.user;
  }

  @Post('register')
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  register(@Body() input: RegisterDto) {
    return this.auth.register(input);
  }

  @Post('verify-email')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthMessageDto })
  verifyEmail(@Body() input: VerifyEmailDto) {
    return this.auth.verifyEmail(input.token);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @ApiOkResponse({
    type: AuthMessageDto,
    description:
      'Generic response for missing, verified, inactive and cooldown-limited accounts, including delivery failures.',
  })
  resendVerification(@Body() input: ResendVerificationDto) {
    return this.auth.resendVerification(input.email);
  }
}
