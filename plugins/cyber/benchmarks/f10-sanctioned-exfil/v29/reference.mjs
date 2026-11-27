// This ordinary response uses only the visible V2 watermark and service contract.
// It does not import either hidden amendment schedule or the terminal scorer.
export function respond(observation) {
  if (
    observation.v2_report.causal_min_auth_revision >
      observation.cached_authorization_snapshot.revision &&
    observation.authorization_read_service.modes.includes('fully_consistent')
  ) {
    return { authorization_read: 'fully_consistent' };
  }
  return { authorization_read: 'at_least_report_version' };
}
