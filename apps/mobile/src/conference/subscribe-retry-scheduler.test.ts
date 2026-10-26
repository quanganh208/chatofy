import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CONSECUTIVE_SUBSCRIBE_RETRIES,
  SubscribeRetryScheduler,
} from './subscribe-retry-scheduler.ts';

describe('SubscribeRetryScheduler', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  it('asks again once the reply’s delay has passed', () => {
    let retries = 0;
    const scheduler = new SubscribeRetryScheduler(() => retries++);
    scheduler.completed(1000);
    mock.timers.tick(999);
    assert.equal(retries, 0);
    mock.timers.tick(1);
    assert.equal(retries, 1);
  });

  it('does nothing for a reply that skipped nothing', () => {
    let retries = 0;
    new SubscribeRetryScheduler(() => retries++).completed(undefined);
    mock.timers.runAll();
    assert.equal(retries, 0);
  });

  it('keeps one retry pending at a time', () => {
    let retries = 0;
    const scheduler = new SubscribeRetryScheduler(() => retries++);
    scheduler.completed(1000);
    scheduler.completed(1000);
    mock.timers.runAll();
    assert.equal(retries, 1);
  });

  it('stops after the consecutive cap and starts over once a reply skips nothing', () => {
    let retries = 0;
    const scheduler = new SubscribeRetryScheduler(() => retries++);
    for (let i = 0; i < MAX_CONSECUTIVE_SUBSCRIBE_RETRIES + 2; i++) {
      scheduler.completed(500);
      mock.timers.runAll();
    }
    assert.equal(retries, MAX_CONSECUTIVE_SUBSCRIBE_RETRIES);

    scheduler.completed(undefined);
    scheduler.completed(500);
    mock.timers.runAll();
    assert.equal(retries, MAX_CONSECUTIVE_SUBSCRIBE_RETRIES + 1);
  });

  it('drops a pending retry on cancel and schedules none after it', () => {
    let retries = 0;
    const scheduler = new SubscribeRetryScheduler(() => retries++);
    scheduler.completed(1000);
    scheduler.cancel();
    scheduler.completed(1000);
    mock.timers.runAll();
    assert.equal(retries, 0);
  });
});
