import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.includes('/node_modules/tar/')) {
      appendFileSync(
        process.env.F8_DEPENDENCY_TRACE,
        `${JSON.stringify({ specifier, url: result.url })}\n`,
      );
    }
    return result;
  },
});
