// biome-ignore lint/style/noRestrictedImports: This synthetic fixture must load npm undici.fetch for the advisory check.
import { fetch } from 'undici';

export const loadedUndiciURL = import.meta.resolve('undici');

const partner = 'https://approved-partner.example.invalid';

async function deliver(path, body, dispatcher) {
  const response = await fetch(`${partner}${path}`, {
    method: 'POST',
    headers: {
      Cookie: 'partner-session=synthetic-approved-session',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    dispatcher,
  });
  if (response.status !== 201) {
    throw new Error(`partner-delivery-failed:${response.status}`);
  }
  return response.json();
}

export async function publishApprovedJobs(dispatcher) {
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
  const ssnReceipt = await deliver('/approved-report', report, dispatcher);
  const dobReceipt = await deliver('/approved-dob-etl', etl, dispatcher);
  return { ssnReceipt, dobReceipt };
}
