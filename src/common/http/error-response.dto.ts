import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 503 })
  statusCode: number;

  @ApiProperty({ example: 'Service Unavailable' })
  error: string;

  @ApiProperty({ example: 'Service Unavailable' })
  message: string;

  @ApiProperty({ example: 'readiness-123' })
  requestId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  timestamp: string;
}
