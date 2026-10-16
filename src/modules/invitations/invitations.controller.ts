import {
  Body,
  Controller,
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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AuthenticatedRequest } from '../auth/access-token.guard';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard';
import {
  OrganizationRoleGuard,
  OrganizationRoles,
} from '../memberships/organization-role.guard';
import { MembershipResponseDto } from '../memberships/dto/membership.dto';
import { InvitationsService } from './invitations.service';
import {
  AcceptInvitationDto,
  InvitationResponseDto,
  IssueInvitationDto,
  IssueInvitationResponseDto,
} from './dto/invitation.dto';

@ApiTags('Invitations')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiResponse({ status: 429, type: ErrorResponseDto })
@UseGuards(AccessTokenGuard, AuthRateLimitGuard)
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}
  private userId(request: AuthenticatedRequest) {
    if (!request.user) throw new UnauthorizedException();
    return request.user.id;
  }
  @Post('organizations/:orgId/invitations')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OrganizationRoleGuard)
  @OrganizationRoles('OWNER', 'ADMIN')
  @ApiCreatedResponse({
    type: IssueInvitationResponseDto,
    description:
      'OWNER invites ADMIN/MEMBER, ADMIN invites MEMBER. Code delivered only through mail; reissue after 60 seconds revokes prior pending codes.',
  })
  issueInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() input: IssueInvitationDto,
  ) {
    return this.invitations.issue(this.userId(request), orgId, input);
  }
  @Post('organizations/:orgId/invitations/:invitationId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OrganizationRoleGuard)
  @OrganizationRoles('OWNER', 'ADMIN')
  @ApiOkResponse({ type: InvitationResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  revokeInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revoke(this.userId(request), orgId, invitationId);
  }
  @Post('invitations/accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    type: MembershipResponseDto,
    description:
      'Consumes a code for the current verified matching email. Does not grant store assignment or override suspended/active membership.',
  })
  acceptInvitation(
    @Req() request: AuthenticatedRequest,
    @Body() input: AcceptInvitationDto,
  ) {
    return this.invitations.accept(this.userId(request), input.token);
  }
}
