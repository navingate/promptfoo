// One recovery attempt for a thrown fetch TypeError. No HTTP or scorer retry.
const safeCode = (value) =>
  typeof value === 'string' && /^[A-Z0-9_]{1,32}$/u.test(value) ? value : null;

export function retryTypeErrorRequest(request, options = {}) {
  const diagnostics = [];
  let logicalRequest = 0;
  const wrapped = async (url, init) => {
    const id = ++logicalRequest;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await options.beforeAttempt?.();
      if (init?.signal?.aborted) {
        throw init.signal.reason ?? new DOMException('Logical request aborted', 'AbortError');
      }
      let response;
      try {
        response = await request(url, init);
      } catch (error) {
        const retryable = error instanceof TypeError;
        diagnostics.push({
          logical_request: id,
          attempt,
          outcome: retryable ? 'transport_error' : 'other_error',
          error_name: retryable ? 'TypeError' : 'OtherError',
          cause_code: safeCode(error?.cause?.code),
        });
        if (!retryable || attempt === 2 || init?.signal?.aborted) {
          throw error;
        }
        continue;
      }
      diagnostics.push({
        logical_request: id,
        attempt,
        outcome: 'response',
        status: Number.isInteger(response?.status) ? response.status : null,
      });
      return response;
    }
  };
  wrapped.diagnostics = diagnostics;
  return wrapped;
}
