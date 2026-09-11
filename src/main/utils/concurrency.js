'use strict';

/**
 * Runs `worker` over `items` with at most `limit` in flight at once,
 * preserving no particular completion order.
 *
 * On the first rejection no new work is started, but the promise only
 * settles once every in-flight call has finished. Rejecting immediately
 * (the previous behavior) left up to `limit - 1` downloads still writing to
 * disk while the caller was already unwinding the launch and reporting the
 * error — the launch looked dead while files kept appearing, and the next
 * attempt raced against writes from the previous one.
 */
function mapWithConcurrency(items, limit, worker) {
  return new Promise((resolve, reject) => {
    const total = items.length;
    if (total === 0) return resolve();

    let nextIndex = 0;
    let inFlight = 0;
    let completed = 0;
    let firstError = null;
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      if (firstError) reject(firstError);
      else resolve();
    };

    const pump = () => {
      while (!firstError && inFlight < limit && nextIndex < total) {
        const index = nextIndex++;
        inFlight++;
        Promise.resolve()
          .then(() => worker(items[index], index))
          .then(
            () => { completed++; },
            (err) => { if (!firstError) firstError = err; }
          )
          .then(() => {
            inFlight--;
            if (firstError) {
              if (inFlight === 0) settle();
              return;
            }
            if (completed === total) settle();
            else pump();
          });
      }

      if (inFlight === 0 && (firstError || completed === total)) settle();
    };

    pump();
  });
}

module.exports = { mapWithConcurrency };
