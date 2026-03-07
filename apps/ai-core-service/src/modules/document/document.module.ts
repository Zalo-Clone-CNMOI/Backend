import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentMetadata, DocumentChunk } from '@libs/database/entities';
import { DocumentEngine } from './document.engine';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentMetadata, DocumentChunk])],
  providers: [DocumentEngine],
  exports: [DocumentEngine],
})
export class DocumentModule {}
