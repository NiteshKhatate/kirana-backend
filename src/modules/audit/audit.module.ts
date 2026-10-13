import { Module } from '@nestjs/common';
import { SecurityEvents } from './security-events.service';

@Module({ providers: [SecurityEvents], exports: [SecurityEvents] })
export class AuditModule {}
