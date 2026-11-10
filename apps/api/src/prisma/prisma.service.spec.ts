import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

const order: string[] = [];

/** Stands in for a provider that writes on its way out, like the LLM call sink. */
@Injectable()
class FlushesOnDestroy implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaService) {}
  onModuleDestroy(): void {
    order.push('flush');
  }
}

@Module({ providers: [FlushesOnDestroy] })
class WriterModule {}

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: { get: () => 'postgresql://u:p@localhost:5434/db' },
    },
  ],
  exports: [ConfigService],
})
class FakeConfigModule {}

// Prisma is imported deeper than the writer here. Nest's destroy order follows
// the module graph; disconnecting in `onApplicationShutdown` takes the question
// out of the graph's hands, since that hook runs after every destroy hook.
@Module({ imports: [PrismaModule] })
class InnerModule {}
@Module({ imports: [InnerModule] })
class MiddleModule {}
@Module({ imports: [FakeConfigModule, WriterModule, MiddleModule] })
class RootModule {}

afterEach(() => {
  order.length = 0;
  vi.restoreAllMocks();
});

describe('PrismaService shutdown', () => {
  it('disconnects only after every module has run its destroy hooks', async () => {
    vi.spyOn(PrismaService.prototype, '$connect').mockResolvedValue(undefined);
    vi.spyOn(PrismaService.prototype, '$disconnect').mockImplementation(
      async () => {
        order.push('disconnect');
      },
    );
    const moduleRef = await Test.createTestingModule({
      imports: [RootModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();
    expect(order).toEqual(['flush', 'disconnect']);
  });
});
