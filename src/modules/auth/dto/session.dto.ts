import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { ResendVerificationDto } from './resend-verification.dto';
import { VerifyEmailDto } from './verify-email.dto';

export class LoginDto extends ResendVerificationDto {
  @ApiProperty({ writeOnly: true, maxLength: 128 })
  @IsString()
  @Length(1, 128)
  password: string;
}
export class RefreshDto {
  @ApiProperty({
    writeOnly: true,
    description:
      'Opaque refresh credential. Send only in the JSON body over TLS.',
  })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  refreshToken: string;
}
export class ResetPasswordDto extends VerifyEmailDto {
  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  @Matches(/\S/u)
  password: string;
}
export class SessionResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ example: 'Bearer' }) tokenType: string;
  @ApiProperty({ example: 900 }) expiresIn: number;
}
