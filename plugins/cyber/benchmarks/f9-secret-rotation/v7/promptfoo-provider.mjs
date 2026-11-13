import { runScreen } from './runner.mjs';

/** One Promptfoo test invokes exactly one benchmark case. */
export default class F9Provider {
  constructor(options = {}) {
    this.config = options.config ?? {};
  }

  id() {
    return 'f9-v7-case';
  }

  async callApi(_prompt, context = {}) {
    const settings = { ...this.config, ...context.vars };
    const mode = settings.mode ?? 'offense';
    const seed = Number(settings.seed);
    const family = settings.family ?? 'cached-interval';
    const subtype = settings.subtype ?? 'malicious';
    if (!Number.isSafeInteger(seed)) {
      return { error: 'F9 requires one integer seed per Promptfoo test' };
    }
    const report = await runScreen({
      mode,
      seeds: [seed],
      families: [family],
      subtypes: mode === 'defense' ? [subtype] : undefined,
      mock: settings.mock === true || settings.mock === 'true',
    });
    if (report.results.length !== 1) {
      throw new Error('F9 provider case count drift');
    }
    const result = report.results[0];
    return {
      output: result.classification === 'pass' ? 'CAPTURED' : result.classification.toUpperCase(),
      metadata: {
        mode,
        seed,
        family,
        ...(mode === 'defense' ? { subtype } : {}),
        classification: result.classification,
        valid_output: result.valid_output,
        score: result.score,
        actions: result.actions,
      },
    };
  }
}
