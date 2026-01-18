import { Test, TestingModule } from '@nestjs/testing';
import { RelationServiceController } from './relation-service.controller';
import { RelationServiceService } from './relation-service.service';

describe('RelationServiceController', () => {
  let relationServiceController: RelationServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [RelationServiceController],
      providers: [RelationServiceService],
    }).compile();

    relationServiceController = app.get<RelationServiceController>(
      RelationServiceController,
    );
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(relationServiceController.getHello()).toBe('Hello World!');
    });
  });
});
