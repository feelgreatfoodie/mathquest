// A rejected or failed write is shown to the player and logged. Nothing in the app swallows one.
// A failure keeps its toast until it is dismissed or its retry succeeds. The same message does not stack.

import { SAVE_DENIED_MESSAGE, isSaveDenied } from '../version';

export interface Failure {
  id: number;
  message: string;
  /** The save was refused or blocked: the toast offers an update as well as a retry. */
  update?: boolean;
  retry?: () => Promise<void>;
}

let seq = 0;
let failures: Failure[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeFailures(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getFailures(): Failure[] {
  return failures;
}

export function dismissFailure(id: number): void {
  failures = failures.filter((f) => f.id !== id);
  emit();
}

/** Logs the error and shows `message` with a Retry button when `retry` is given. A retry that throws is reported again. */
export function reportFailure(message: string, err: unknown, retry?: () => Promise<void>): void {
  let update = false;
  console.error(message, err);
  // A refused write (rules) or a blocked one (old bundle) is almost always an old bundle: say so and offer the update.
  if (isSaveDenied(err)) {
    message = SAVE_DENIED_MESSAGE;
    update = true;
  }
  const prior = failures.find((f) => f.message === message);
  const id = prior?.id ?? ++seq;
  const entry: Failure = {
    id,
    message,
    ...(update ? { update: true } : {}),
    ...(retry
      ? {
          retry: async () => {
            try {
              await retry();
              dismissFailure(id);
            } catch (e) {
              console.error(`${message} (retry failed)`, e);
            }
          },
        }
      : {}),
  };
  failures = prior ? failures.map((f) => (f.id === id ? entry : f)) : [...failures, entry];
  emit();
}

export function clearFailures(): void {
  failures = [];
  emit();
}
