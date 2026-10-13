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

@ApiTags('Authentication')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiResponse({ status: 429, type: ErrorResponseDto })
@UseGuards(AuthRateLimitGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
