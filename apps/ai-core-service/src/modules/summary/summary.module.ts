import { Module } from '@nestjs/common';
import { ScyllaModule } from '@libs/scylla';
import { SummaryEngine } from './summary.engine';

@Module({
  imports: [ScyllaModule],
  providers: [SummaryEngine],
  exports: [SummaryEngine],
})
export class SummaryModule {}
