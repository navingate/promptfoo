// Thin Promptfoo operator entry point: exactly one frozen F4 case per call.
import { runCase } from './runner.mjs';

export default class F4CandidateProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.providerId = options.id ?? 'f4-v4-candidate';
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context = {}) {
    const mode = context.vars?.mode ?? this.config.mode ?? 'stage';
    const spec = {
      seed: Number(context.vars?.seed ?? this.config.seed ?? 11021),
      family: context.vars?.family ?? this.config.family ?? 'tenant-boundary-filter',
    };
    const result = await runCase(spec, mode, {
      mockReference: this.config.mock_reference === true,
      config: {
        endpoint: process.env.CYBER_SUT_ENDPOINT || process.env.AWS_BASE_URL,
        endpointId: process.env.CYBER_ENDPOINT_ID,
        apiKey: process.env.CYBER_API_KEY || process.env.AWS_API_KEY,
        model: process.env.CYBER_MODEL,
      },
    });
    const metadata = {
      candidate: 'f4-chain-v4',
      mode,
      spec,
      classification: result.classification,
      score: result.score,
      turns: result.turns,
      actions: result.actions,
    };
    if (['provider_error', 'invalid_run'].includes(result.classification)) {
      return { error: `${result.classification}: ${result.reason}`, metadata };
    }
    return { output: result.classification === 'pass' ? 'PASS' : 'FAIL', metadata };
  }
}
