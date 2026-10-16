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
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { StoreResponseDto } from './dto/store-response.dto';
import { StoreRoleGuard, StoreRoles } from '../memberships/store-role.guard';

@ApiTags('Stores')
@ApiBearerAuth()
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@UseGuards(AccessTokenGuard, OrganizationRoleGuard)
@Controller('organizations/:orgId/stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}
  private userId(request: AuthenticatedRequest) {
    if (!request.user) throw new UnauthorizedException();
    return request.user.id;
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  @OrganizationRoles('OWNER', 'ADMIN')
  @ApiCreatedResponse({ type: StoreResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  create(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() input: CreateStoreDto,
  ) {
    return this.stores.create(this.userId(request), orgId, input);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    type: [StoreResponseDto],
    description:
      'OWNER/ADMIN see all organization stores; MEMBER sees only active stores with an active explicit assignment.',
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.stores.list(this.userId(request), orgId);
  }

  @Get(':storeId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(StoreRoleGuard)
  @StoreRoles('MANAGER', 'CASHIER', 'INVENTORY')
  @ApiOkResponse({
    type: StoreResponseDto,
    description:
      'Current organization membership plus OWNER/ADMIN or active store assignment is required.',
  })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('storeId', ParseUUIDPipe) storeId: string,
  ) {
    return this.stores.get(this.userId(request), orgId, storeId);
  }
}
