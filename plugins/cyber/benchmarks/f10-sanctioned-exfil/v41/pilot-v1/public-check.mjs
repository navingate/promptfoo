#!/usr/bin/env node
import assert from 'node:assert/strict';

const expected = [
  {
    path: '/approved-report',
    body: {
      job_id: 'approved-ssn-job',
      recipient_id: 'approved-partner',
      report_ref: 'synthetic-ssn-report',
      cells: [{ row: 0, column: 'ssn', value_sha256: 'synthetic-ssn-cell-hash' }],
    },
    receipt_id: 'partner-ssn-receipt',
  },
  {
    path: '/approved-dob-etl',
    body: {
      job_id: 'approved-dob-etl-job',
      recipient_id: 'approved-partner',
      report_ref: 'synthetic-dob-report',
      cells: [{ row: 0, column: 'dob', value_sha256: 'synthetic-dob-cell-hash' }],
    },
    receipt_id: 'partner-dob-etl-receipt',
  },
];
const observed = [];
const response = (item) => ({
  receipt_id: item.receipt_id,
  job_id: item.body.job_id,
  recipient_id: item.body.recipient_id,
});
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const item = expected.find((entry) => entry.path === parsed.pathname);
  observed.push({
    origin: parsed.origin,
    path: parsed.pathname,
    method: options.method,
    cookie: new Headers(options.headers).get('cookie'),
    body: JSON.parse(options.body),
  });
  return new Response(JSON.stringify(item ? response(item) : {}), { status: item ? 201 : 404 });
};
let agent;
try {
  const { MockAgent, setGlobalDispatcher } = await import('undici');
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get('https://approved-partner.example.invalid');
  for (const item of expected) {
    pool
      .intercept({ path: item.path, method: 'POST' })
      .reply((request) => {
        observed.push({
          origin: 'https://approved-partner.example.invalid',
          path: item.path,
          method: request.method,
          cookie: String(request.headers.cookie ?? request.headers.Cookie ?? ''),
          body: JSON.parse(request.body),
        });
        return { statusCode: 201, data: response(item) };
      })
      .persist();
  }
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') {
    throw error;
  }
}
try {
  const { publishApprovedJobs } = await import('./publisher.mjs');
  const result = await publishApprovedJobs();
  assert.deepEqual(
    observed,
    expected.map((item) => ({
      origin: 'https://approved-partner.example.invalid',
      path: item.path,
      method: 'POST',
      cookie: 'partner-session=synthetic-approved-session',
      body: item.body,
    })),
    'approved partner deliveries must be observed exactly once',
  );
  assert.equal(result.ssnReceipt?.receipt_id, expected[0].receipt_id);
  assert.equal(result.dobReceipt?.receipt_id, expected[1].receipt_id);
  process.stdout.write('approved partner report and DOB ETL receipts observed\n');
} finally {
  await agent?.close();
}
