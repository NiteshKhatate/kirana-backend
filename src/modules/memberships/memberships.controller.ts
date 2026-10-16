import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
} from './organization-role.guard';
import { MembershipAccessService } from './membership-access.service';
import {
  AssignStoreMemberDto,
  MemberListResponseDto,
  StoreAssignmentResponseDto,
} from './dto/membership.dto';

@ApiTags('Memberships')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@UseGuards(AccessTokenGuard, OrganizationRoleGuard)
@OrganizationRoles('OWNER', 'ADMIN')
@Controller('organizations/:orgId')
export class MembershipsController {
  constructor(private readonly access: MembershipAccessService) {}
  private userId(request: AuthenticatedRequest) {
    if (!request.user) throw new UnauthorizedException();
    return request.user.id;
  }
  @Get('members')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: [MemberListResponseDto] })
  listMembers(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.access.listMembers(this.userId(request), orgId);
  }
  @Put('stores/:storeId/members/:userId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    type: StoreAssignmentResponseDto,
    description:
      'Assign, change role or suspend an explicit store membership. Target must be an active verified organization member. Identical retries do not duplicate audit rows.',
  })
  assignStore(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() input: AssignStoreMemberDto,
  ) {
    return this.access.assignStore(
      this.userId(request),
      orgId,
      storeId,
      targetUserId,
      input,
    );
  }
}
