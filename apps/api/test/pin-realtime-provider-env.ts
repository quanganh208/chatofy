/**
 * Pin `AI_REALTIME_PROVIDER` before anything reads it.
 *
 * `ConfigModule.forRoot()` sits inside a `@Module` decorator, so the dotenv file
 * is read the moment `app-config.module.ts` is imported — before any `beforeAll`
 * can run. Assigning the variable from a hook is therefore too late, which is
 * why this is a side-effect module imported ahead of `AppModule` instead.
 *
 * It exists because `apps/api/.env` is not in version control and, on a machine
 * that has been through this repo's earlier history, still carries
 * `AI_REALTIME_PROVIDER=none` from when the realtime provider was an interface
 * with no implementation. A suite whose result depends on an untracked local
 * file is not a suite, and this one caught exactly that.
 */
process.env.AI_REALTIME_PROVIDER = 'gemini-live';
