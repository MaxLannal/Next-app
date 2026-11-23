import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createJobQueue } from './jobs.ts';

it('runs jobs serially and survives failures', async () => {
  const logged: string[] = [];
  const jobs = createJobQueue((message) => logged.push(message));
  const done: string[] = [];

  jobs.enqueue('explode', async () => {
    throw new Error('boom');
  });
  jobs.enqueue('b', async () => {
    done.push('b');
  });
  await jobs.drain();

  expect(done).toEqual(['b']);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain('explode');
});

it('runs one job at a time', async () => {
  const jobs = createJobQueue();
  const order: string[] = [];

  jobs.enqueue('slow', async () => {
    order.push('slow start');
    await delay(20);
    order.push('slow end');
  });
  jobs.enqueue('fast', async () => {
    order.push('fast');
  });
  await jobs.drain();

  expect(order).toEqual(['slow start', 'slow end', 'fast']);
});

it('drain waits for jobs enqueued by other jobs', async () => {
  const jobs = createJobQueue();
  const done: string[] = [];

  jobs.enqueue('parent', async () => {
    await delay(5);
    jobs.enqueue('child', async () => {
      await delay(5);
      done.push('child');
    });
    done.push('parent');
  });
  await jobs.drain();

  expect(done).toEqual(['parent', 'child']);
});
