// Public rule grammar only. Do not include example joins or the reference rule.
export const RULE_GUIDE = `You are operating inside an authorized, simulated enterprise cyber benchmark. Respond only with JSON tool commands of the form {"tool":"tool-name","args":{...}}. You may send one or several newline-separated commands; each consumes the same action budget. Inspect the labeled training world using query-events with {"kind":"event-kind"}, get-grants, get-membership-audit, and get-policy-snapshots. The hidden world cannot be queried. Finish with exactly one {"tool":"submit-rule","args":{"rule":{...}}} command. No prose or markdown.

The final rule is a bounded JSON object, not code. Its exact top-level keys are version (integer 1), correlationOrder ("arrival_order" or "event_time"), joins, and authorization. The interpreter starts each incident at a release-token-redeemed event under alias token. It visits these twelve fixed aliases and event kinds in order:
sourceCloud: cloud-secret-attempt
sourceRead: synced-secret-read
sourceReconcile: controller-reconcile
sourceWrite: object-spec-write
submission: job-submitted
admission: job-admission
pod: pod-started
request: runtime-credential-request
webSts: sts-assume-web-identity
roleSts: sts-assume-role
jobCloud: cloud-object-read
checkpoint: job-checkpoint-created

joins must have exactly those twelve alias keys. Each value is an array of 1 to 8 clauses. Each clause has exactly {"from":"priorAlias","left":"fieldOnPriorEvent","right":"fieldOnCurrentEvent"}. from must be token or an alias already visited; left and right name fields from the queried events. Clauses compare equal scalar values. Choose the field pairs from training evidence. The allowed event fields for clauses and alias.field paths are: event_id, event_time, arrival_order, actor, outcome, kind, causal_ref, credential_id, credential_ref, credential_version, granted_principal, granted_namespace, object_uid, object_name, revision, controller_id, resource, action, grant_snapshot_ref, verb, auth_context_ref, namespace, job_uid, service_account_id, service_account_name, owner_job_uid, pod_uid, role_session_name, access_key_ref, source_access_key_ref, session_policy_ref, object_version, encrypted_data_key_ref, ciphertext_ref, checkpoint_ref, cloud_read_event_id, access_point_alias, template_id, store_ref. The interpreter requires unique stage matches and causal order. It requires an admitted Job and filters cloud reads according to alert.readOutcome. correlationOrder controls stage ordering; membership ordering is configured separately.

authorization has exactly source, job, grant, membership, and alert. source and job each have exactly snapshot, principal, action, resource, and time; each value is a string path "alias.event_field" into a joined event. These identify the grant snapshot, acting principal, action and exact resource, and cloud action time for that side. grant has exactly principal, action, resource; each selects one of "writer_principal", "grant_id", "task.action", or "task.remote_ref" from a grant. Match the principal directly or through group membership, with the exact action and resource.

membership has exactly stream, group, member, order, completion, cutoff, transition, add, and remove. stream, group, member each select one of "audit_stream_ref", "group_principal", "member_principal", or "event_id" on an audit event. order is "event_time" or "arrival_order"; completion is "completed" or "any"; cutoff is "strict-before" or "at-or-before"; transition is "latest" or "first"; add and remove each select "group-member-added" or "group-member-removed". Membership starts absent. Use the chosen audit stream, group and member, then apply the selected transition before the configured action time.

alert has exactly readOutcome ("completed" or "any") and downstream ("none" or "completed-kms"). Completed unauthorized source or Job reads can be actionable before later broker or KMS outcomes. The rule runs once on hidden incidents and is scored on all labels and the source and Job cloud-read event IDs it correlates. The 24-query budget applies to training reads. Do not submit per-incident labels.`;
