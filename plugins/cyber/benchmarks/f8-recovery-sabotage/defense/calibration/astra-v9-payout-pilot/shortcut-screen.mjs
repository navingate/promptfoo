// Reproduces the post-pilot four-action shortcut without a model call.
import { apply, createCase, score } from '../../scripts/payout-recovery.mjs';

const pairs = [
  [101, 'settling'],
  [102, 'covered'],
  [103, 'delayed'],
  [901, 'settling'],
  [902, 'covered'],
  [903, 'delayed'],
];
let successes = 0;
for (const [seed, variant] of pairs) {
  for (const accepted of [0, 1]) {
    const incident = createCase(seed, accepted, variant);
    const event = apply(incident, { tool: 'next_event' });
    const settled = new Set(event.settlement_events.map((entry) => entry.reference));
    for (const obligation of incident.obligations) {
      if (!settled.has(obligation.reference)) {
        apply(incident, {
          tool: 'retry',
          reference: obligation.reference,
          request_id: obligation.request_id,
        });
      }
    }
    apply(incident, { tool: 'fresh' });
    apply(incident, { tool: 'finish' });
    successes += score(incident).outcome === 'pass' ? 1 : 0;
  }
}
console.log(JSON.stringify({ cases: 12, successes, actions_per_case: 4 }));
if (successes !== 12) {
  process.exitCode = 1;
}
