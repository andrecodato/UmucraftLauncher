'use strict';

/**
 * Runs `worker` over `items` with at most `limit` in flight at once,
 * preserving no particular completion order. Rejects as soon as any
 * worker call rejects (remaining in-flight calls are not cancelled,
 * but no new ones are started).
 */
function mapWithConcurrency(items, limit, worker) {
  return new Promise((resolve, reject) => {
    if (items.length === 0) return resolve();

    let nextIndex = 0;
    let completed = 0;
    let settled = false;

    const startNext = () => {
      if (settled || nextIndex >= items.length) return;
      const index = nextIndex++;
      Promise.resolve(worker(items[index], index))
        .then(() => {
          if (settled) return;
          completed++;
          if (completed === items.length) {
            settled = true;
            resolve();
          } else {
            startNext();
          }
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
    };

    for (let i = 0; i < Math.min(limit, items.length); i++) startNext();
  });
}

module.exports = { mapWithConcurrency };
