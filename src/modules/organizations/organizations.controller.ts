import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/access-token.guard';
import {
  OrganizationRoleGuard,
  OrganizationRoles,
} from '../memberships/organization-role.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiBadRequestResponse({ type: ErrorResponseDto })
@UseGuards(AccessTokenGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}
  private userId(request: AuthenticatedRequest) {
    if (!request.user) throw new UnauthorizedException();
    return request.user.id;
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({
    type: OrganizationResponseDto,
    description:
      'Creates organization and owner atomically; identical slug/payload retries by the active creator-owner return the original organization.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateOrganizationDto,
  ) {
    return this.organizations.create(this.userId(request), input);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: [OrganizationResponseDto] })
  list(@Req() request: AuthenticatedRequest) {
    return this.organizations.list(this.userId(request));
  }

  @Get(':orgId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OrganizationRoleGuard)
  @OrganizationRoles('OWNER', 'ADMIN', 'MEMBER')
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.organizations.get(this.userId(request), orgId);
  }
}
