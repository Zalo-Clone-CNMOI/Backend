import { Module } from '@nestjs/common';
import { TranslationEngine } from './translation.engine';

@Module({
  providers: [TranslationEngine],
  exports: [TranslationEngine],
})
export class TranslationModule {}
