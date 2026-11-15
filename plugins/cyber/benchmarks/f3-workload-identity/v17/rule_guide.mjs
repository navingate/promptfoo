import { RULE_GUIDE as V16_RULE_GUIDE } from '../v16/rule_guide.mjs';

export const RULE_GUIDE = `${V16_RULE_GUIDE.replaceAll('version (integer 2)', 'version (integer 3)')
  .replaceAll('"version":2', '"version":3')
  .replaceAll('version-2 rule', 'version-3 rule')
  .replace(
    'authorization has exactly source, job, grant, membership, and alert.',
    'authorization has exactly source, job, owner, grant, membership, and alert.',
  )
  .replace(
    'source has exactly snapshot, principal, action, resource, time, and controller; job has exactly snapshot, principal, action, resource, time, serviceAccount, and template.',
    'source has exactly snapshot, principal, action, resource, time, and controller; job and owner each have exactly snapshot, principal, action, resource, time, serviceAccount, and template.',
  )
  .replace(
    'The allowed event fields for clauses and alias.field paths are:',
    'The allowed event fields for clauses and alias.field paths are: owner_snapshot_ref, approval_stream_ref, owner_approval_stream_ref, role_arn (joins only),',
  )}

The admitted workload has two independent organizational approval lanes:
change authorization and data-owner authorization. A completed read is
approved only if both lanes cover that exact read. Both may change while the
Job runs. The submitter does not choose the initial approval snapshots or
admitted streams. The cloud read's authorization_snapshot_ref is a runtime
cloud policy snapshot, not an organizational approval verdict.

get-grants returns immutable grant_snapshots and approval_publications. Each
grant snapshot carries the approval_stream_ref of its owner. Each publication
has approval_stream_ref, previous_snapshot_ref, new_snapshot_ref, event_time,
arrival_order and outcome. Only completed, linear revisions on the admitted
stream with event_time strictly earlier than a read take effect. Failed
revisions, arrival order and other streams do not change that read's approval.

For v3, job and owner snapshot may be a base submission path or a bounded
selector object with exactly mode ("latest-completed-revision"), base (a
submission snapshot path for that lane), and stream (its admitted stream
path). The change lane uses grant_snapshot_ref and approval_stream_ref; the
owner lane uses owner_snapshot_ref and owner_approval_stream_ref. The source
snapshot remains an alias.event_field path. The other scoped-grant and
correlation fields retain their v16 meaning. Submit one reusable rule for
the separate hidden world.`;
