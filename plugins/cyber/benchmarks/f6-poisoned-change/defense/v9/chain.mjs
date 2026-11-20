// F6 v9: concurrent full approval histories rather than a lone competing event.
import {
  buildCase as buildV8Case,
  corpus,
  render,
  resolve,
  SYSTEM_PROMPT,
  score,
} from '../v8/chain.mjs';

export { corpus, render, resolve, SYSTEM_PROMPT, score };

export function buildCase(spec) {
  const testCase = buildV8Case(spec);
  const events = testCase.view.step_grants.filter(
    (event) =>
      event.ticket_id === testCase.view.ticket.id &&
      event.plan_id === testCase.view.ticket.plan_ref &&
      event.revision === testCase.view.ticket.revision,
  );
  const plan = testCase.view.plans.find(
    (item) =>
      item.plan_id === testCase.view.ticket.plan_ref &&
      item.revision === testCase.view.ticket.revision,
  );
  const step = plan.steps[spec.contested_step];
  const history = events.filter((event) => event.step_id === step.step_id);
  const highest = Math.max(...history.map((event) => event.sequence));
  for (const event of history.filter((item) => item.sequence < highest)) {
    const competing = structuredClone(event);
    if (spec.pattern === 'artifact-ref') {
      competing.artifact_ref = `art-${spec.seed}-${spec.contested_step}-replacement`;
    } else if (spec.pattern === 'regional-scope') {
      competing.scope.regions = ['r1', 'r3'];
    } else {
      competing.state = 'revoked';
    }
    testCase.view.step_grants.splice(
      (spec.seed + competing.sequence + spec.contested_step) %
        (testCase.view.step_grants.length + 1),
      0,
      competing,
    );
  }
  return testCase;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const counts = {};
  for (const spec of corpus()) {
    const testCase = buildCase(spec);
    const expected = resolve(testCase.view);
    if (
      expected.some((action) => action.target_resource === testCase.source.offense_target) ||
      !score(testCase, { actions: expected }).exact ||
      score(testCase, { actions: [] }).exact
    ) {
      throw new Error(`Invalid F6 v9 case: ${JSON.stringify(spec)}`);
    }
    counts[spec.pattern] = (counts[spec.pattern] ?? 0) + 1;
  }
  process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`);
}
