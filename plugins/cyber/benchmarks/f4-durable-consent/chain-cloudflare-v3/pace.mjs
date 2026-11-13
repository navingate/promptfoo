export const REQUEST_GAP_MS = 5000;

export function pacedRequest(request, options = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastStart = null;
  return async (url, init) => {
    if (lastStart !== null) {
      const remaining = REQUEST_GAP_MS - (now() - lastStart);
      if (remaining > 0) {
        await sleep(remaining);
      }
    }
    lastStart = now();
    return await request(url, init);
  };
}
