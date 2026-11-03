import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

/**
 * The dev env file, shared by every app in the repo and by Compose. Resolved
 * from this file rather than the working directory, so `nest start`, the e2e
 * suites and any cwd agree: src/config and dist/config sit at the same depth
 * (tsconfig.build's rootDir is ./src). Absent in the images, where @nestjs/config
 * skips a missing file and compose supplies every value.
 */
const REPO_ROOT_ENV = resolve(__dirname, '../../../..', '.env');

/**
 * Global config module — wraps @nestjs/config with zod validation.
 * Marked @Global so ConfigService is available everywhere without re-importing.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: REPO_ROOT_ENV,
      validate: validateEnv,
      cache: true,
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
