/**
 * @file test-database.helper.ts
 *
 * Provides mock TypeORM Repository factories for integration tests.
 * Since SQLite lacks PostgreSQL-specific features (enum columns, ILike),
 * we mock repositories at the interface level while preserving real NestJS DI.
 */

/**
 * Create a mock TypeORM Repository with all common methods pre-mocked.
 * Each method returns a sensible default (null, [], 0, etc.)
 * and can be overridden per-test via mockResolvedValue / mockImplementation.
 */
export function createMockRepository<T = unknown>() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest
      .fn()
      .mockImplementation((entity: T) =>
        Promise.resolve({ id: 'mock-id', ...entity } as T),
      ),
    create: jest.fn().mockImplementation((dto: Partial<T>) => dto as T),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    remove: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    exists: jest.fn().mockResolvedValue(false),
    createQueryBuilder: jest.fn().mockReturnValue(createMockQueryBuilder()),
    manager: {
      transaction: jest
        .fn()
        .mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => {
          return cb({
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation((e: T) => Promise.resolve(e)),
          });
        }),
    },
    metadata: {
      columns: [],
      relations: [],
    },
  };
}

/**
 * Create a mock QueryBuilder with chainable methods.
 * Supports the fluent API pattern used throughout the codebase.
 */
export function createMockQueryBuilder() {
  const qb: Record<string, jest.Mock> = {};

  const chainable = [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orWhere',
    'update',
    'delete',
    'from',
    'set',
    'innerJoin',
    'leftJoin',
    'innerJoinAndSelect',
    'leftJoinAndSelect',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'groupBy',
    'having',
    'setParameters',
    'setParameter',
  ];

  for (const method of chainable) {
    qb[method] = jest.fn().mockReturnThis();
  }

  // Terminal methods
  qb['getOne'] = jest.fn().mockResolvedValue(null);
  qb['getMany'] = jest.fn().mockResolvedValue([]);
  qb['getManyAndCount'] = jest.fn().mockResolvedValue([[], 0]);
  qb['getCount'] = jest.fn().mockResolvedValue(0);
  qb['getRawOne'] = jest.fn().mockResolvedValue(null);
  qb['getRawMany'] = jest.fn().mockResolvedValue([]);
  qb['execute'] = jest.fn().mockResolvedValue({ affected: 0 });

  return qb;
}

/**
 * Reset all mocks in a repository created by createMockRepository.
 */
export function resetMockRepository(
  repo: ReturnType<typeof createMockRepository>,
) {
  for (const value of Object.values(repo)) {
    if (typeof value === 'function' && 'mockClear' in value) {
      value.mockClear();
    }
  }
}
