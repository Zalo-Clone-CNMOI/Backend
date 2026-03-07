import { Module } from '@nestjs/common';
import { SmartReplyEngine } from './smart-reply.engine';

@Module({
  providers: [SmartReplyEngine],
  exports: [SmartReplyEngine],
})
export class SmartReplyModule {}
