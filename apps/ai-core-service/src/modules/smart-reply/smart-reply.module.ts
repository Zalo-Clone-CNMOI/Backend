import { Module } from '@nestjs/common';
import { ScyllaModule } from '@libs/scylla';
import { SmartReplyEngine } from './smart-reply.engine';

@Module({
  imports: [ScyllaModule],
  providers: [SmartReplyEngine],
  exports: [SmartReplyEngine],
})
export class SmartReplyModule {}
