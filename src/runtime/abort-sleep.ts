/**
 * Abort-aware sleep for rate-limit backoff (OpenAI + Anthropic clients).
 */

export function abortError(): Error {
  const e = new Error('Run cancelled by user');
  e.name = 'AbortError';
  return e;
}

export function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}
