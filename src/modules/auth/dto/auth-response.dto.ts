import { ApiProperty } from '@nestjs/swagger';
import { PublicUserDto } from '../../users/public-user';

export class RegisterResponseDto {
  @ApiProperty({ type: PublicUserDto })
  user: PublicUserDto;
  @ApiProperty({
    enum: ['development-outbox', 'smtp-accepted', 'resend-accepted', 'failed'],
    description:
      'Email-provider acceptance is not a guarantee of inbox delivery. Failed delivery preserves the account; use resend after the cooldown.',
  })
  verificationEmailDelivery: string;
}

export class AuthMessageDto {
  @ApiProperty()
  message: string;
}
