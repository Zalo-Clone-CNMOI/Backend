import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// const useSsl = process.env.DB_SSL === 'true';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5439'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'zaloclone',
  ssl: { rejectUnauthorized: false },
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
  entities: ['libs/database/src/entities/*.entity.ts'],
  migrations: ['migrations/*.ts'],
});
