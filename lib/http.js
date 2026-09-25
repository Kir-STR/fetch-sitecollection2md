const retryable = status => status === 429 || status >= 500;
const realSleep = ms => new Promise(r => setTimeout(r, ms));

export function retryAfterMs(value, max, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), max);
}

export function createGet({
  delayMs = 1000, timeoutMs = 30000, attempts = 3, backoffMs = 1000, maxRetryAfterMs = 60000,
  userAgent = 'fetch-sitecollection2md/0.1', sleep = realSleep,
} = {}) {
  let last = -Infinity;
  async function pace() {
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  }
  return async function get(url, init = {}) {
    let reason;
    for (let i = 1; i <= attempts; i++) {
      await pace();
      let res;
      try {
        res = await fetch(url, { ...init, headers: { 'user-agent': userAgent, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        reason = e.name === 'TimeoutError' ? `timeout ${timeoutMs}ms` : (e.cause?.code ?? e.message);
        if (i < attempts) await sleep(backoffMs * i);
        continue;
      }
      if (res.ok) return res;
      if (!retryable(res.status)) throw new Error(`GET ${url} -> ${res.status}`);
      reason = `status ${res.status}`;
      await res.body?.cancel();
      if (i < attempts) await sleep(retryAfterMs(res.headers.get('retry-after'), maxRetryAfterMs) ?? backoffMs * i);
    }
    throw new Error(`GET ${url} failed after ${attempts} attempts: ${reason}`);
  };
}
