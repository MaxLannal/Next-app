export type JobQueue = {
  enqueue(label: string, fn: () => Promise<void>): void;
  /** Resolves once the queue is empty, including jobs enqueued by running jobs. */
  drain(): Promise<void>;
};

export type JobLog = (message: string, error: unknown) => void;

/** Runs background jobs one at a time. A failed job is logged and the queue moves on. */
export function createJobQueue(log: JobLog = (message, error) => console.error(message, error)): JobQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(label, fn) {
      tail = tail.then(() => fn()).catch((error: unknown) => log(`Job "${label}" failed`, error));
    },
    async drain() {
      let seen: Promise<void>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },
  };
}
