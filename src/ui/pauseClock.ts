import { ServerClock, serverMsFromDate } from '../engine/pause';

/** One server-clock estimate for the whole app. A device clock change cannot move it (see ServerClock). */
export const serverClock = new ServerClock();

/** Anchors the clock to the `Date` header of a response from the app's own host. True when it worked. Offline: false, and the clock keeps what it had. */
export async function syncServerClock(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`/?pause-clock=${Math.floor(performance.now())}`, { method: 'HEAD', cache: 'no-store' });
    const ms = serverMsFromDate(res.headers.get('date'));
    if (ms === null) return false;
    serverClock.sync(ms);
    return true;
  } catch {
    return false;
  }
}
