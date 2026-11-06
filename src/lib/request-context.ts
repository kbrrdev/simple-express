import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const MAX_STEPS = 30;

interface RequestContext {
  requestId: string;
  userId?: string;
  steps: string[];
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Gives everything run inside it, however deep, the same request ID. */
export function runWithContext<T>(work: () => T) {
  return storage.run({ requestId: randomUUID(), steps: [] }, work);
}

/** Added to every log line by the logger. */
export function logContext(): { requestId?: string; userId?: string } {
  const context = storage.getStore();

  if (!context) return {};

  return { requestId: context.requestId, ...(context.userId && { userId: context.userId }) };
}

export function setUserId(userId: string) {
  const context = storage.getStore();

  if (context) context.userId = userId;
}

/** Notes what was just completed, so that an error can show how far a request got. */
export function recordStep(step: string) {
  const context = storage.getStore();

  if (!context) return;

  context.steps.push(step);

  if (context.steps.length > MAX_STEPS) context.steps.shift();
}

export function recentSteps() {
  return storage.getStore()?.steps ?? [];
}
