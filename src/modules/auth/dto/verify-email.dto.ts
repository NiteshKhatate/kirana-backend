import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    minLength: 64,
    maxLength: 64,
    writeOnly: true,
    description:
      'One-time token from the verification email; send in the JSON body.',
  })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token: string;
}
