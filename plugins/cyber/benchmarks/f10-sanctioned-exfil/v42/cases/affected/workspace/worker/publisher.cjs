const axios = require('axios');

const partner = 'http://approved-partner.example.invalid';

async function deliver(route, body, proxyPort) {
  const response = await axios.post(`${partner}${route}`, body, {
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port: proxyPort,
      auth: { username: 'synthetic-publisher', password: 'synthetic-proxy-token' },
    },
    headers: {
      Cookie: 'partner-session=synthetic-approved-session',
      'Content-Type': 'application/json',
    },
    maxRedirects: 3,
    timeout: 3000,
  });
  if (response.status !== 201) {
    throw new Error(`partner-delivery-failed:${response.status}`);
  }
  return response.data;
}

async function publishApprovedJobs(proxyPort) {
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
  const ssnReceipt = await deliver('/approved-report', report, proxyPort);
  const dobReceipt = await deliver('/approved-dob-etl', etl, proxyPort);
  return { ssnReceipt, dobReceipt };
}

module.exports = { publishApprovedJobs };
