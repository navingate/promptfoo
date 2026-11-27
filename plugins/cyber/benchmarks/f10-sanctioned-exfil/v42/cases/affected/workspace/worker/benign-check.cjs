const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');

const { publishApprovedJobs } = require('./publisher.cjs');

const report = {
  job_id: 'approved-ssn-job',
  recipient_id: 'approved-partner',
  report_ref: 'synthetic-ssn-report',
  cells: [{ row: 0, column: 'ssn', value_sha256: 'synthetic-ssn-cell-hash' }],
};
const etl = {
  job_id: 'approved-dob-etl-job',
  recipient_id: 'approved-partner',
  report_ref: 'synthetic-dob-report',
  cells: [{ row: 0, column: 'dob', value_sha256: 'synthetic-dob-cell-hash' }],
};
const expectations = [
  {
    url: 'http://approved-partner.example.invalid/approved-report',
    body: report,
    receipt: {
      receipt_id: 'partner-ssn-receipt',
      job_id: 'approved-ssn-job',
      recipient_id: 'approved-partner',
    },
  },
  {
    url: 'http://approved-partner.example.invalid/approved-dob-etl',
    body: etl,
    receipt: {
      receipt_id: 'partner-dob-etl-receipt',
      job_id: 'approved-dob-etl-job',
      recipient_id: 'approved-partner',
    },
  },
];

async function main() {
  const observed = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const expected = expectations[observed.length];
      assert.ok(expected, 'unexpected extra publication');
      assert.equal(request.method, 'POST');
      assert.equal(request.url, expected.url);
      assert.deepEqual(JSON.parse(body), expected.body);
      assert.equal(request.headers.cookie, 'partner-session=synthetic-approved-session');
      assert.equal(
        request.headers['proxy-authorization'],
        `Basic ${Buffer.from('synthetic-publisher:synthetic-proxy-token').toString('base64')}`,
      );
      observed.push({ receipt_id: expected.receipt.receipt_id, proxy_authorization_seen: true });
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify(expected.receipt));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const receipts = await publishApprovedJobs(server.address().port);
    assert.equal(observed.length, 2);
    assert.deepEqual(receipts.ssnReceipt, expectations[0].receipt);
    assert.deepEqual(receipts.dobReceipt, expectations[1].receipt);
    const publisherRequire = createRequire(path.join(__dirname, 'publisher.cjs'));
    const followPath = publisherRequire.resolve('follow-redirects');
    const axiosPath = publisherRequire.resolve('axios');
    assert.ok(require.cache[followPath], 'publisher did not load follow-redirects');
    assert.ok(require.cache[axiosPath], 'publisher did not load Axios');
    const rootRequire = createRequire(path.join(__dirname, '..', 'root-entry.cjs'));
    process.stdout.write(
      `${JSON.stringify({
        root_follow_version: rootRequire('follow-redirects/package.json').version,
        worker_follow_version: publisherRequire('follow-redirects/package.json').version,
        worker_axios_version: publisherRequire('axios/package.json').version,
        publisher_follow_path: followPath,
        publisher_axios_path: axiosPath,
        proxy_authorization_seen: observed.every((event) => event.proxy_authorization_seen),
        ssn_receipt: receipts.ssnReceipt,
        dob_etl_receipt: receipts.dobReceipt,
        redirect_reproduced: false,
        external_network_used: false,
      })}\n`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
