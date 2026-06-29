import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { IntermediaryCategory } from '../../database/entities/enums';

export class RegisterDto {
  @ApiProperty({ example: 'compliance@newbroker.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Broker@123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'New Broker Securities Pvt Ltd' })
  @IsString()
  tenantName: string;

  @ApiProperty({ enum: ['stock_broker', 'investment_adviser'], example: 'stock_broker' })
  @IsIn(['stock_broker', 'investment_adviser'])
  category: IntermediaryCategory;

  @ApiProperty({
    required: false,
    example: { is_qsb: false, holds_client_funds: true },
    description: 'Drives applicability filtering (QSB, client funds, …).',
  })
  @IsOptional()
  @IsObject()
  profile?: Record<string, unknown>;
}
