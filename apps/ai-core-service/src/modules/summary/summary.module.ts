import { Module } from '@nestjs/common';
import { SummaryEngine } from './summary.engine';

@Module({
  providers: [SummaryEngine],
  exports: [SummaryEngine],
})
export class SummaryModule {}
