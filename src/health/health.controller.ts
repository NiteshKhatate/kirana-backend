import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ErrorResponseDto } from '../common/http/error-response.dto';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

class ReadinessResponse {
  @ApiProperty({ example: 'ok' })
  status: string;

  @ApiProperty({ example: 'connected' })
  database: string;
}

class LivenessResponse {
  @ApiProperty({ example: 'ok' })
  status: string;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ type: ReadinessResponse })
  @ApiServiceUnavailableResponse({
    description: 'Database is unavailable',
    type: ErrorResponseDto,
  })
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        database: 'connected',
      };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }

  @Get('live')
  @ApiOkResponse({ type: LivenessResponse })
  live() {
    return { status: 'ok' };
  }
}
