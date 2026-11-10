import {
  Module,
  type INestApplicationContext,
  type Type,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { validateEnv } from '../config/env.schema';
import { CreditOwnerTools } from '../modules/credits/credit-owner-tools.service';
import { CreditsLedger } from '../modules/credits/credits-ledger.service';
import { PlanCatalog } from '../modules/credits/plan-catalog';
import { PrismaModule } from '../prisma/prisma.module';
import {
  CliRefusal,
  guardDatabase,
  type GuardInput,
  type GuardIo,
} from './cli-prod-guard';

/**
 * Just what the credits CLI needs: config, Prisma, the ledger and the owner
 * tools. Not the credits module itself — that would start the reaper and the
 * HTTP routes in a process that exists to run one command.
 *
 * Built only after the environment has been checked. The config module is the
 * app's (`AppConfigModule`) set up here rather than imported: importing it
 * runs `ConfigModule.forRoot` and its validation at load, which fails as an
 * uncaught error with a stack trace before the CLI could say what is missing.
 */
function creditsCliModule(): Type {
  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: REPO_ROOT_ENV,
        validate: validateEnv,
        cache: true,
      }),
      PrismaModule,
    ],
    providers: [PlanCatalog, CreditsLedger, CreditOwnerTools],
  })
  class CreditsCliModule {}
  return CreditsCliModule;
}

export interface CliContext {
  app: INestApplicationContext;
  ledger: CreditsLedger;
  owner: CreditOwnerTools;
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
  print: (line: string) => void;
}

const terminalIo: GuardIo = {
  isTTY: Boolean(process.stdin.isTTY),
  print: (line) => console.log(line),
  async ask(question) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
};

/**
 * The dev env file, resolved the way `AppConfigModule` resolves it (src/cli and
 * src/config sit at the same depth). Loaded here, before anything boots, so the
 * guard reads the same DATABASE_URL the app would connect to; real environment
 * variables still win, and the images have no such file.
 */
const REPO_ROOT_ENV = resolve(__dirname, '../../../..', '.env');

export interface CliCommand {
  /** Validates the arguments and says what the command will do; runs before anything connects. */
  describe(
    positionals: string[],
    values: CliContext['values'],
  ): Omit<GuardInput, 'databaseUrl' | 'prod'>;
  run(ctx: CliContext): Promise<void>;
}

/**
 * Runs one credits command and sets the exit code: 0 on success, 1 on a
 * refusal or a failure. Arguments and the database guard are checked before
 * the app boots, so a bad argument or an unconfirmed production database is
 * refused without a connection ever being opened to it.
 */
export function runCreditsCli(
  options: ParseArgsConfig['options'],
  usage: string,
  command: CliCommand,
): void {
  void (async () => {
    let app: INestApplicationContext | null = null;
    try {
      const { positionals, values } = parseArgs({
        args: process.argv.slice(2),
        options: { prod: { type: 'boolean' }, ...options },
        allowPositionals: true,
        strict: true,
      });
      const flags = values as CliContext['values'];
      const intent = command.describe(positionals, flags);
      loadEnv({ path: REPO_ROOT_ENV, quiet: true });
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) throw new CliRefusal('DATABASE_URL is not set.');
      await guardDatabase(
        { ...intent, databaseUrl, prod: flags.prod === true },
        terminalIo,
      );
      try {
        validateEnv(process.env);
      } catch (err) {
        throw new CliRefusal(
          `${err instanceof Error ? err.message : String(err)}\nSet these in the environment (or the repo's .env) and run again.`,
        );
      }
      // abortOnError off: a boot failure reaches the catch below as one line,
      // instead of Nest printing it with a stack and exiting on its own.
      app = await NestFactory.createApplicationContext(creditsCliModule(), {
        logger: ['error', 'warn'],
        abortOnError: false,
      });
      await command.run({
        app,
        ledger: app.get(CreditsLedger),
        owner: app.get(CreditOwnerTools),
        positionals,
        values: flags,
        print: (line) => console.log(line),
      });
      process.exitCode = 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(err instanceof CliRefusal ? message : `Failed: ${message}`);
      if (!(err instanceof CliRefusal)) console.error(usage);
      process.exitCode = 1;
    } finally {
      await app?.close();
    }
  })();
}
