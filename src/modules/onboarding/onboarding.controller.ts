import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OrganizationStatus } from '@prisma/client';
import { ErrorResponseDto } from '../../common/http/error-response.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/access-token.guard';
import {
  OrganizationRoleGuard,
  OrganizationRoles,
} from '../memberships/organization-role.guard';
import { OnboardingService } from './onboarding.service';

export class OnboardingResponseDto {
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty({ example: 'FIRST_STORE' }) currentStep: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  completedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiProperty({ enum: OrganizationStatus })
  organizationStatus: OrganizationStatus;
}

@ApiTags('Onboarding')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@UseGuards(AccessTokenGuard, OrganizationRoleGuard)
@Controller('organizations/:orgId/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}
  private userId(request: AuthenticatedRequest) {
    if (!request.user) throw new UnauthorizedException();
    return request.user.id;
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: OnboardingResponseDto })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.onboarding.get(this.userId(request), orgId);
  }
  @Post('complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @OrganizationRoles('OWNER', 'ADMIN')
  @ApiOkResponse({
    type: OnboardingResponseDto,
    description:
      'Requires an active verified owner and an active store. Repeated completion is idempotent.',
  })
  complete(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.onboarding.complete(this.userId(request), orgId);
  }
}
