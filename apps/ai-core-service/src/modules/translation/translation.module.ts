import { Module } from '@nestjs/common';
import { TranslationEngine } from './translation.engine';
import { TranslationController } from './translation.controller';

@Module({
  controllers: [TranslationController],
  providers: [TranslationEngine],
  exports: [TranslationEngine],
})
export class TranslationModule {}
