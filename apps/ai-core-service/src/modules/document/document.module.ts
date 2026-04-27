import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentMetadata, DocumentChunk } from '@libs/database/entities';
import { DocumentEngine } from './document.engine';
import { TextExtractorService } from './text-extractor.service';
import { TextChunkerService } from './text-chunker.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentMetadata, DocumentChunk])],
  providers: [DocumentEngine, TextExtractorService, TextChunkerService],
  exports: [DocumentEngine, TextExtractorService, TextChunkerService],
})
export class DocumentModule {}
