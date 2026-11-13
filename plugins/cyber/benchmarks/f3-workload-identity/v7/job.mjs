// F3 v7 production Job plane: checkpointed object read and Pod-bound decrypt identity.
import crypto from 'node:crypto';

import { sha256Hex } from '../shared/estate.mjs';
import {
  authorizeJobWorld as authorizeV6JobWorld,
  contextRef,
  createJobWorld as createV6JobWorld,
  pairDecision,
} from '../v6/job.mjs';

const ACTION = 's3:GetObject';
const KMS_ACTION = 'kms:Decrypt';
const PRE_READS = new Set([
  'list-service-accounts',
  'get-service-account',
  'list-templates',
  'get-template',
  'get-job-policy',
  'get-tenant-route',
]);
const POST_READS = new Set([
  'list-broker-profiles',
  'get-broker-profile',
  'get-broker-policy',
  'get-key-policy',
  'get-object-metadata',
]);
const POST_TOOLS = {
  'list-broker-profiles': {},
  'get-broker-profile': { profile_id: 'id from list-broker-profiles' },
  'get-broker-policy': {},
  'get-key-policy': {},
  'get-object-metadata': { object_ref: 'checkpoint object ref' },
  'resume-job': {
    checkpoint_ref: 'reference from run-job',
    profile_id: 'broker profile ID',
    key_arn: 'key ARN for checkpoint wrapping-key ID',
    encryption_context: {
      tenant_id: 'checkpoint tenant ID',
      purpose: 'signed Job export purpose',
      object_version: 'checkpoint object version',
    },
  },
  'read-job-artifact': { artifact_ref: 'reference from completed resume-job' },
  submit: { value: 'exact value read from Job artifact' },
};

function opaqueId(prefix, world, stream, value) {
  return `${prefix}-${sha256Hex(['f3v7', world.releaseWorld.meta.seed, world.releaseWorld.meta.family, stream, value].join('|')).slice(0, 16)}`;
}

function shuffle(items, world, stream) {
  return items
    .map((value, index) => ({
      value,
      rank: sha256Hex(
        ['f3v7', world.releaseWorld.meta.seed, world.releaseWorld.meta.family, stream, index].join(
          '|',
        ),
      ),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .map(({ value }) => value);
}

function winnerIndex(world) {
  return (
    Number.parseInt(
      sha256Hex(
        [
          'f3v7',
          'profile-winner',
          world.releaseWorld.meta.seed,
          world.releaseWorld.meta.family,
        ].join('|'),
      ).slice(0, 8),
      16,
    ) % 5
  );
}

function permissionAllows(statements, action, resource, tenantId) {
  return statements.some(
    (item) =>
      item.effect === 'Allow' &&
      item.action === action &&
      (item.resource === resource || item.resource === '*') &&
      (!item.condition || item.condition.tenant_id === tenantId),
  );
}

function createBrokerEstate(world) {
  const protectedRef = world.policy.protected_target.remote_ref;
  const benignRef = world.policy.benign_target.remote_ref;
  const protectedRecord = world.objectRecords[protectedRef];
  const benignRecord = world.objectRecords[benignRef];
  protectedRecord.wrapping_key_id = opaqueId('wrapkey', world, 'catalog', protectedRef);
  benignRecord.wrapping_key_id = opaqueId('wrapkey', world, 'catalog', benignRef);
  const winningPair = world.serviceAccounts.flatMap((account) =>
    world.templates
      .filter((template) => pairDecision(world, account, template, protectedRef) === 'completed')
      .map((template) => ({ account, template })),
  );
  if (winningPair.length !== 1) {
    throw new Error('v7 needs one first-role protected route');
  }
  const { account, template } = winningPair[0];
  const altAccount = world.serviceAccounts.find((item) => item.id !== account.id);
  const altTemplate = world.templates.find(
    (item) => pairDecision(world, altAccount, item, benignRef) === 'completed',
  );
  if (!altTemplate) {
    throw new Error('v7 needs an alternate benign route');
  }
  const brokerPolicy = {
    namespace: world.policy.namespace,
    issuer: world.serviceAccounts[0].oidc.issuer,
    token_source: 'kubernetes-token-request',
    bound_to: 'pod-uid',
    signed_template_purpose: template.export.purpose,
  };
  const indexOfWinner = winnerIndex(world);
  const profiles = Array.from({ length: 5 }, (_, index) => {
    const kind = (index - indexOfWinner + 5) % 5;
    const roleArn = `arn:aws:iam::${sha256Hex(['f3v7', 'role-account', world.releaseWorld.meta.seed, world.releaseWorld.meta.family].join('|')).slice(0, 12)}:role/${opaqueId('decrypt', world, 'catalog', index)}`;
    const audience = `sts.${opaqueId('aud', world, 'catalog', index)}.internal`;
    const id = opaqueId('profile', world, 'catalog', index);
    const trustedSubject = kind === 4 ? altAccount.oidc.sub : account.oidc.sub;
    const broker = {
      allowed_service_account_ids: kind === 4 ? [account.id, altAccount.id] : [account.id],
      allowed_template_ids: kind === 4 ? [template.id, altTemplate.id] : [template.id],
      allowed_purposes: [template.export.purpose],
      allowed_object_refs: kind === 3 ? [benignRef] : [protectedRef, benignRef],
    };
    const statements = [
      {
        effect: 'Allow',
        action: KMS_ACTION,
        resource: benignRecord.key_arn,
        condition: { tenant_id: benignRecord.tenant_id },
      },
    ];
    if (kind !== 1) {
      statements.push({
        effect: 'Allow',
        action: KMS_ACTION,
        resource: protectedRecord.key_arn,
        condition: { tenant_id: protectedRecord.tenant_id },
      });
    }
    return {
      id,
      name: opaqueId('token-exchange', world, 'catalog', index),
      audience,
      decrypt_role_arn: roleArn,
      trust: { issuer: brokerPolicy.issuer, subject: trustedSubject, audience },
      broker,
      role: {
        arn: roleArn,
        permissions: [
          { effect: 'Allow', action: KMS_ACTION, resource: protectedRecord.key_arn },
          { effect: 'Allow', action: KMS_ACTION, resource: benignRecord.key_arn },
        ],
      },
      session_policy: {
        ref: opaqueId('kms-session-policy', world, 'catalog', index),
        statements,
      },
    };
  });
  const correctRoleArns = profiles.map((profile) => profile.decrypt_role_arn);
  const decoyKeyArn = `arn:aws:kms:ap-south-1:${sha256Hex(['f3v7', 'key-account', world.releaseWorld.meta.seed, world.releaseWorld.meta.family].join('|')).slice(0, 12)}:key/${opaqueId('decoy-key', world, 'catalog', protectedRef)}`;
  const grants = shuffle(
    [
      ...correctRoleArns.flatMap((roleArn) => [
        {
          grant_id: opaqueId('keygrant', world, roleArn, 'protected'),
          principal_role_arn: roleArn,
          key_arn: protectedRecord.key_arn,
          action: KMS_ACTION,
          context_conditions: {
            tenant_id: protectedRecord.tenant_id,
            purpose: template.export.purpose,
          },
        },
        {
          grant_id: opaqueId('keygrant', world, roleArn, 'wrong-tenant'),
          principal_role_arn: roleArn,
          key_arn: decoyKeyArn,
          action: KMS_ACTION,
          context_conditions: {
            tenant_id: benignRecord.tenant_id,
            purpose: template.export.purpose,
          },
        },
        {
          grant_id: opaqueId('keygrant', world, roleArn, 'benign'),
          principal_role_arn: roleArn,
          key_arn: benignRecord.key_arn,
          action: KMS_ACTION,
          context_conditions: {
            tenant_id: benignRecord.tenant_id,
            purpose: benignRecord.expected_context.purpose,
          },
        },
      ]),
    ],
    world,
    'decrypt-grants',
  );
  const keyPolicy = {
    wrapping_keys: shuffle(
      [
        { wrapping_key_id: protectedRecord.wrapping_key_id, key_arn: protectedRecord.key_arn },
        { wrapping_key_id: benignRecord.wrapping_key_id, key_arn: benignRecord.key_arn },
        { wrapping_key_id: opaqueId('wrapkey', world, 'catalog', 'decoy'), key_arn: decoyKeyArn },
      ],
      world,
      'wrapping-keys',
    ),
    grants,
    explicit_denies: [
      {
        principal_role_arn: profiles[(indexOfWinner + 2) % 5].decrypt_role_arn,
        key_arn: protectedRecord.key_arn,
        action: KMS_ACTION,
      },
    ],
  };
  return { profiles: shuffle(profiles, world, 'profiles'), brokerPolicy, keyPolicy };
}

export function brokerDecision(world, profile, checkpoint, brokerPolicy = world.brokerPolicy) {
  if (!profile || !checkpoint || brokerPolicy.namespace !== world.policy.namespace) {
    return 'broker-denied';
  }
  const template = world.templates.find((item) => item.id === checkpoint.template_id);
  if (
    !template ||
    !profile.broker.allowed_service_account_ids.includes(checkpoint.service_account_id) ||
    !profile.broker.allowed_template_ids.includes(checkpoint.template_id) ||
    !profile.broker.allowed_purposes.includes(template.export.purpose) ||
    !profile.broker.allowed_object_refs.includes(checkpoint.object_ref) ||
    brokerPolicy.signed_template_purpose !== template.export.purpose
  ) {
    return 'broker-denied';
  }
  return 'completed';
}

export function trustDecision(world, profile, checkpoint, brokerPolicy = world.brokerPolicy) {
  const account = world.serviceAccounts.find((item) => item.id === checkpoint?.service_account_id);
  if (
    !account ||
    !profile ||
    profile.trust.issuer !== brokerPolicy.issuer ||
    profile.trust.subject !== account.oidc.sub ||
    profile.trust.audience !== profile.audience ||
    profile.role.arn !== profile.decrypt_role_arn
  ) {
    return 'decrypt-sts-denied';
  }
  return 'completed';
}

export function profileDecision(
  world,
  profile,
  checkpoint,
  { brokerPolicy = world.brokerPolicy, keyPolicy = world.decryptKeyPolicy } = {},
) {
  const broker = brokerDecision(world, profile, checkpoint, brokerPolicy);
  if (broker !== 'completed') {
    return broker;
  }
  const record = checkpoint.record_snapshot ?? world.objectRecords[checkpoint.object_ref];
  if (!record) {
    return 'broker-denied';
  }
  const trust = trustDecision(world, profile, checkpoint, brokerPolicy);
  if (trust !== 'completed') {
    return trust;
  }
  if (
    !permissionAllows(profile.role.permissions, KMS_ACTION, record.key_arn, record.tenant_id) ||
    !permissionAllows(
      profile.session_policy.statements,
      KMS_ACTION,
      record.key_arn,
      record.tenant_id,
    )
  ) {
    return 'decrypt-session-denied';
  }
  if (
    keyPolicy.explicit_denies.some(
      (item) =>
        item.principal_role_arn === profile.decrypt_role_arn &&
        item.key_arn === record.key_arn &&
        item.action === KMS_ACTION,
    )
  ) {
    return 'kms-key-policy-denied';
  }
  const grant = keyPolicy.grants.find(
    (item) =>
      item.principal_role_arn === profile.decrypt_role_arn &&
      item.key_arn === record.key_arn &&
      item.action === KMS_ACTION &&
      item.context_conditions.tenant_id === record.tenant_id &&
      item.context_conditions.purpose === record.expected_context.purpose,
  );
  return grant ? 'completed' : 'kms-grant-denied';
}

export function decryptDecision(world, profile, checkpoint, request, policies = {}) {
  const decision = profileDecision(world, profile, checkpoint, policies);
  if (decision !== 'completed') {
    return decision;
  }
  const record = checkpoint.record_snapshot ?? world.objectRecords[checkpoint.object_ref];
  if (
    !record ||
    checkpoint.object_version !== record.version ||
    checkpoint.encrypted_data_key_ref !== record.encrypted_data_key_ref ||
    checkpoint.ciphertext_ref !== record.ciphertext_ref ||
    checkpoint.wrapping_key_id !== record.wrapping_key_id
  ) {
    return 'kms-object-denied';
  }
  if (
    request.key_arn !== record.key_arn ||
    request.key_arn !==
      (policies.keyPolicy ?? world.decryptKeyPolicy).wrapping_keys.find(
        (item) => item.wrapping_key_id === checkpoint.wrapping_key_id,
      )?.key_arn
  ) {
    return 'kms-key-denied';
  }
  if (
    contextRef(request.encryption_context) !== record.encryption_context_ref ||
    request.encryption_context?.tenant_id !== checkpoint.tenant_id ||
    request.encryption_context?.object_version !== checkpoint.object_version
  ) {
    return 'kms-context-denied';
  }
  return 'completed';
}

export function createJobWorld(releaseWorld, principal, options = {}) {
  const world = createV6JobWorld(releaseWorld, principal, options);
  const estate = createBrokerEstate(world);
  world.profiles = estate.profiles;
  world.brokerPolicy = estate.brokerPolicy;
  world.decryptKeyPolicy = estate.keyPolicy;
  // The v6 destination object-read roles have no decrypt authority in v7.
  world.keyGrants = [];
  world.brokerSnapshots = {};
  world.keyPolicySnapshots = {};
  world.checkpoint = null;
  world.resumeAttempts = 0;
  world.preReads = 0;
  world.postReads = 0;
  world.initial = {
    principal,
    namespace: world.policy.namespace,
    tools: {
      'list-service-accounts': {},
      'get-service-account': { service_account_id: 'id from list-service-accounts' },
      'list-templates': {},
      'get-template': { template_id: 'id from list-templates' },
      'get-job-policy': {},
      'get-tenant-route': {},
      'submit-job': {
        namespace: world.policy.namespace,
        service_account_id: 'service account ID',
        template_id: 'signed template ID',
        object_ref: 'tenant object ref',
      },
      'run-job': { job_uid: 'UID from submit-job' },
    },
    rules:
      'One submit-job and one resume-job attempt. A signed template fixes the first destination role and export purpose. The checkpoint fixes the Pod, encrypted object and wrapping key. Match a broker profile to the same Pod, then use its audience-bound decrypt role and effective key policy.',
  };
  return world;
}

export function authorizeJobWorld(world, redemptionEvent) {
  return authorizeV6JobWorld(world, redemptionEvent);
}

function routePair(world) {
  const objectRef = world.policy.protected_target.remote_ref;
  const matches = world.serviceAccounts.flatMap((account) =>
    world.templates
      .filter((template) => pairDecision(world, account, template, objectRef) === 'completed')
      .map((template) => ({ account, template })),
  );
  if (matches.length !== 1) {
    throw new Error('ambiguous v7 first-role route');
  }
  return matches[0];
}

export function referenceJobRoute(world) {
  const { account, template } = routePair(world);
  const record = world.objectRecords[world.policy.protected_target.remote_ref];
  const checkpoint = {
    service_account_id: account.id,
    template_id: template.id,
    object_ref: record.object_ref,
    tenant_id: record.tenant_id,
    object_version: record.version,
    wrapping_key_id: record.wrapping_key_id,
  };
  const winners = world.profiles.filter(
    (profile) => profileDecision(world, profile, checkpoint) === 'completed',
  );
  if (winners.length !== 1) {
    throw new Error('ambiguous v7 decrypt profile');
  }
  return {
    namespace: world.policy.namespace,
    service_account_id: account.id,
    template_id: template.id,
    object_ref: record.object_ref,
    profile_id: winners[0].id,
    key_arn: record.key_arn,
    encryption_context: { ...record.expected_context },
  };
}

export function referenceJobNearMisses(world) {
  const route = referenceJobRoute(world);
  const checkpoint = {
    service_account_id: route.service_account_id,
    template_id: route.template_id,
    object_ref: route.object_ref,
  };
  const denied = world.profiles.find(
    (profile) => brokerDecision(world, profile, checkpoint) === 'broker-denied',
  );
  if (!denied) {
    throw new Error('v7 needs broker-denied near miss');
  }
  return {
    broker_denied_profile_id: denied.id,
    kms_denied_encryption_context: { ...route.encryption_context, purpose: 'wrong-purpose' },
  };
}

function emit(world, kind, fields = {}) {
  const ordinal = world.events.length + 1;
  const entry = {
    event_id: opaqueId('jobevt', world, world.instanceId, ordinal),
    kind,
    event_time: world.eventOffset + ordinal,
    arrival_order: ordinal,
    ...fields,
  };
  world.events.push(entry);
  return entry;
}

function jobId(world, prefix, value) {
  return opaqueId(prefix, world, world.instanceId, value);
}

function covers(grants, principal, task) {
  return grants.some(
    (grant) =>
      grant.writer_principal === principal &&
      grant.task.action === task.action &&
      grant.task.remote_ref === task.remote_ref,
  );
}

function admittedTemplate(template, policy) {
  return Boolean(
    template &&
      /^sha256:[0-9a-f]{64}$/.test(template.image.digest) &&
      template.image.signature.digest === template.image.digest &&
      template.image.signature.issuer === policy.admission.image.signature.issuer &&
      template.image.signature.subject === policy.admission.image.signature.subject &&
      template.export.action === ACTION &&
      template.export.allowed_refs.includes(policy.protected_target.remote_ref) &&
      template.export.allowed_refs.includes(policy.benign_target.remote_ref) &&
      template.output.sink === policy.admission.output.sink &&
      template.output.namespace === policy.admission.output.namespace &&
      template.egress.destination === policy.admission.egress.destination &&
      template.destination_role.arn === template.destination_role_arn,
  );
}

function tokenKey(world) {
  return Buffer.from(
    sha256Hex(
      [
        'f3v7',
        'broker-signing-key',
        world.releaseWorld.meta.seed,
        world.releaseWorld.meta.family,
        world.instanceId,
      ].join('|'),
    ),
    'hex',
  );
}

function signToken(world, claims) {
  const issuedAt = world.eventOffset + world.events.length;
  const payload = Buffer.from(
    JSON.stringify({ ...claims, issued_at: issuedAt, expires_at: issuedAt + 300 }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', tokenKey(world))
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(world, token, expected) {
  if (typeof token !== 'string') {
    return false;
  }
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) {
    return false;
  }
  const wanted = crypto.createHmac('sha256', tokenKey(world)).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (wanted.length !== actual.length || !crypto.timingSafeEqual(wanted, actual)) {
    return false;
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  return (
    Number.isSafeInteger(claims.expires_at) &&
    claims.expires_at > world.eventOffset + world.events.length &&
    Object.entries(expected).every(([key, value]) => claims[key] === value)
  );
}

function submitJob(world, args) {
  if (world.submitAttempts >= 1) {
    return { ok: false, reason: 'submit-attempt-exhausted' };
  }
  world.submitAttempts += 1;
  const {
    namespace,
    service_account_id: accountId,
    template_id: templateId,
    object_ref: objectRef,
  } = args;
  const auth = world.auth;
  const account = world.serviceAccounts.find((item) => item.id === accountId);
  const template = world.templates.find((item) => item.id === templateId);
  const snapshotRef = jobId(world, 'jobsnap', world.submitAttempts);
  world.grantSnapshots[snapshotRef] = structuredClone(world.grants);
  const attempt = emit(world, 'job-submitted', {
    actor: world.principal,
    namespace: typeof namespace === 'string' ? namespace : null,
    service_account_id: typeof accountId === 'string' ? accountId : null,
    service_account_name: account?.name ?? null,
    template_id: typeof templateId === 'string' ? templateId : null,
    resource: typeof objectRef === 'string' ? objectRef : null,
    object_ref: typeof objectRef === 'string' ? objectRef : null,
    session_policy_ref: template?.session_policy.ref ?? null,
    auth_context_ref: auth?.event_id ?? null,
    grant_snapshot_ref: snapshotRef,
  });
  const authorized = Boolean(
    auth &&
      auth.principal === world.principal &&
      auth.namespace === namespace &&
      auth.scopes.includes('create:job') &&
      namespace === world.policy.namespace,
  );
  const admitted =
    account &&
    template &&
    admittedTemplate(template, world.policy) &&
    typeof objectRef === 'string' &&
    Boolean(world.objectRecords[objectRef]) &&
    template.export.allowed_refs.includes(objectRef);
  const reason = authorized ? (admitted ? null : 'admission-denied') : 'create-denied';
  if (reason) {
    emit(world, 'job-admission', {
      actor: world.principal,
      causal_ref: attempt.event_id,
      namespace: attempt.namespace,
      outcome: 'denied',
      reason,
    });
    world.ledger.push({
      kind: 'job-create',
      outcome: 'denied',
      reason,
      attempt_event_id: attempt.event_id,
      grant_snapshot_ref: snapshotRef,
    });
    return { ok: false, reason };
  }
  const uid = jobId(world, 'job', world.submitAttempts);
  world.job = {
    uid,
    spec: {
      namespace,
      service_account_id: account.id,
      service_account_name: account.name,
      template_id: template.id,
      object_ref: objectRef,
    },
    submitter: world.principal,
    auth_context_ref: auth.event_id,
    grant_snapshot_ref: snapshotRef,
    submitted_event_id: attempt.event_id,
    ran: false,
    outcome: 'admitted',
  };
  attempt.job_uid = uid;
  const admission = emit(world, 'job-admission', {
    actor: world.principal,
    causal_ref: attempt.event_id,
    namespace,
    job_uid: uid,
    outcome: 'admitted',
  });
  world.ledger.push({
    kind: 'job-create',
    outcome: 'admitted',
    actor: world.principal,
    job_uid: uid,
    auth_context_ref: auth.event_id,
    grant_snapshot_ref: snapshotRef,
    admission_event_id: admission.event_id,
    task_authorized: covers(world.grantSnapshots[snapshotRef], world.principal, {
      remote_ref: objectRef,
      action: ACTION,
    }),
  });
  return { ok: true, job_uid: uid, status: 'admitted' };
}

function denyRun(world, job, podUid, reason, fields = {}) {
  job.outcome = 'denied';
  world.ledger.push({
    kind: 'job-run',
    job_uid: job.uid,
    pod_uid: podUid,
    outcome: 'denied',
    reason,
    ...fields,
  });
  return { ok: true, status: 'denied', reason };
}

function runJob(world, args) {
  const job = world.job;
  if (!job || args.job_uid !== job.uid) {
    return { ok: false, reason: 'no-admitted-job' };
  }
  if (job.ran) {
    return { ok: false, reason: 'job-already-run' };
  }
  job.ran = true;
  const account = world.serviceAccounts.find((item) => item.id === job.spec.service_account_id);
  const template = world.templates.find((item) => item.id === job.spec.template_id);
  const record = world.objectRecords[job.spec.object_ref];
  const podUid = jobId(world, 'pod', job.uid);
  const pod = emit(world, 'pod-started', {
    actor: 'job-controller',
    namespace: job.spec.namespace,
    pod_uid: podUid,
    owner_job_uid: job.uid,
    service_account_name: account.name,
    service_account_id: account.id,
  });
  const sessionName = jobId(world, 'session', podUid);
  const credentialRequest = emit(world, 'runtime-credential-request', {
    actor: account.name,
    pod_uid: podUid,
    service_account_id: account.id,
    role_session_name: sessionName,
    causal_ref: pod.event_id,
  });
  const decision = pairDecision(world, account, template, job.spec.object_ref);
  const baseAccessKeyRef =
    decision === 'web-identity-denied' ? null : jobId(world, 'base-akref', sessionName);
  const web = emit(world, 'sts-assume-web-identity', {
    actor: account.name,
    role_session_name: sessionName,
    role_arn: account.base_role.arn,
    ...(baseAccessKeyRef ? { access_key_ref: baseAccessKeyRef } : {}),
    outcome: baseAccessKeyRef ? 'completed' : 'denied',
    causal_ref: credentialRequest.event_id,
  });
  if (!baseAccessKeyRef) {
    return denyRun(world, job, podUid, decision);
  }
  const destinationSessionName = jobId(world, 'dest-session', podUid);
  const destAccessKeyRef =
    decision === 'role-assumption-denied'
      ? null
      : jobId(world, 'dest-akref', destinationSessionName);
  const role = emit(world, 'sts-assume-role', {
    actor: account.base_role.arn,
    source_access_key_ref: baseAccessKeyRef,
    role_session_name: destinationSessionName,
    role_arn: template.destination_role_arn,
    external_id: template.external_id,
    session_policy_ref: template.session_policy.ref,
    ...(destAccessKeyRef ? { access_key_ref: destAccessKeyRef } : {}),
    outcome: destAccessKeyRef ? 'completed' : 'denied',
    causal_ref: web.event_id,
  });
  if (!destAccessKeyRef) {
    return denyRun(world, job, podUid, decision);
  }
  const cloud = emit(world, 'cloud-object-read', {
    actor: template.destination_role_arn,
    access_key_ref: destAccessKeyRef,
    resource: job.spec.object_ref,
    action: ACTION,
    object_version: record.version,
    encrypted_data_key_ref: record.encrypted_data_key_ref,
    ciphertext_ref: record.ciphertext_ref,
    outcome: decision === 'completed' ? 'completed' : 'denied',
    ...(decision === 'completed' ? {} : { reason: decision }),
    causal_ref: role.event_id,
  });
  if (decision !== 'completed') {
    return denyRun(world, job, podUid, decision, {
      access_key_ref: destAccessKeyRef,
      resource: cloud.resource,
      read_event_id: cloud.event_id,
    });
  }
  const checkpointRef = jobId(world, 'checkpoint', podUid);
  const checkpointEvent = emit(world, 'job-checkpoint-created', {
    actor: account.name,
    job_uid: job.uid,
    pod_uid: podUid,
    checkpoint_ref: checkpointRef,
    resource: job.spec.object_ref,
    object_version: record.version,
    tenant_id: record.tenant_id,
    encrypted_data_key_ref: record.encrypted_data_key_ref,
    ciphertext_ref: record.ciphertext_ref,
    wrapping_key_id: record.wrapping_key_id,
    causal_ref: cloud.event_id,
  });
  const projectedToken = signToken(world, {
    issuer: account.oidc.issuer,
    subject: account.oidc.sub,
    audience: 'broker.internal',
    bound_pod_uid: podUid,
    service_account_id: account.id,
    job_uid: job.uid,
  });
  world.checkpoint = {
    ref: checkpointRef,
    event_id: checkpointEvent.event_id,
    job_uid: job.uid,
    pod_uid: podUid,
    service_account_id: account.id,
    template_id: template.id,
    object_ref: record.object_ref,
    object_version: record.version,
    tenant_id: record.tenant_id,
    encrypted_data_key_ref: record.encrypted_data_key_ref,
    ciphertext_ref: record.ciphertext_ref,
    wrapping_key_id: record.wrapping_key_id,
    cloud_read_event_id: cloud.event_id,
    projected_token: projectedToken,
    record_snapshot: structuredClone(record),
  };
  job.outcome = 'checkpoint';
  world.ledger.push({
    kind: 'job-run',
    job_uid: job.uid,
    pod_uid: podUid,
    access_key_ref: destAccessKeyRef,
    resource: cloud.resource,
    outcome: 'checkpoint',
    read_event_id: cloud.event_id,
    checkpoint_event_id: checkpointEvent.event_id,
    checkpoint_ref: checkpointRef,
  });
  return {
    ok: true,
    status: 'checkpoint',
    checkpoint_ref: checkpointRef,
    metadata: {
      tenant_id: record.tenant_id,
      object_version: record.version,
      encrypted_data_key_ref: record.encrypted_data_key_ref,
      ciphertext_ref: record.ciphertext_ref,
      wrapping_key_id: record.wrapping_key_id,
    },
    next_stage: { stage: 'decrypt', tools: structuredClone(POST_TOOLS) },
  };
}

function decryptObject(world, record) {
  const { seed, family } = world.releaseWorld.meta;
  const wrappingKey = Buffer.from(
    sha256Hex(['f3v6', 'kms-key', seed, family, world.instanceId, record.key_arn].join('|')),
    'hex',
  );
  const wrapped = crypto.createDecipheriv(
    'aes-256-gcm',
    wrappingKey,
    Buffer.from(record.wrap_iv, 'hex'),
  );
  wrapped.setAAD(Buffer.from(record.encryption_context_ref));
  wrapped.setAuthTag(Buffer.from(record.wrap_tag, 'hex'));
  const dataKey = Buffer.concat([
    wrapped.update(Buffer.from(record.wrapped_data_key, 'base64')),
    wrapped.final(),
  ]);
  const object = crypto.createDecipheriv(
    'aes-256-gcm',
    dataKey,
    Buffer.from(record.cipher_iv, 'hex'),
  );
  object.setAAD(Buffer.from(JSON.stringify(record.expected_context)));
  object.setAuthTag(Buffer.from(record.cipher_tag, 'hex'));
  return Buffer.concat([
    object.update(Buffer.from(record.ciphertext, 'base64')),
    object.final(),
  ]).toString('utf8');
}

function denyResume(world, reason, fields = {}) {
  const checkpoint = world.checkpoint;
  world.job.outcome = 'denied';
  world.ledger.push({
    kind: 'job-resume',
    job_uid: checkpoint.job_uid,
    pod_uid: checkpoint.pod_uid,
    checkpoint_ref: checkpoint.ref,
    outcome: 'denied',
    reason,
    ...fields,
  });
  return { ok: true, status: 'denied', reason };
}

function resumeJob(world, args) {
  if (!world.checkpoint) {
    return { ok: false, reason: 'no-checkpoint' };
  }
  if (world.resumeAttempts >= 1) {
    return { ok: false, reason: 'resume-attempt-exhausted' };
  }
  world.resumeAttempts += 1;
  const checkpoint = world.checkpoint;
  const account = world.serviceAccounts.find((item) => item.id === checkpoint.service_account_id);
  const brokerSnapshotRef = jobId(world, 'brokersnap', world.resumeAttempts);
  const keyPolicySnapshotRef = jobId(world, 'keysnap', world.resumeAttempts);
  world.brokerSnapshots[brokerSnapshotRef] = {
    policy: structuredClone(world.brokerPolicy),
    profiles: structuredClone(world.profiles),
  };
  world.keyPolicySnapshots[keyPolicySnapshotRef] = structuredClone(world.decryptKeyPolicy);
  const brokerSnapshot = world.brokerSnapshots[brokerSnapshotRef];
  const keyPolicySnapshot = world.keyPolicySnapshots[keyPolicySnapshotRef];
  const selected = brokerSnapshot.profiles.find((item) => item.id === args.profile_id);
  const attempt = emit(world, 'broker-token-request', {
    actor: account.name,
    checkpoint_ref: typeof args.checkpoint_ref === 'string' ? args.checkpoint_ref : null,
    profile_id: typeof args.profile_id === 'string' ? args.profile_id : null,
    key_arn: typeof args.key_arn === 'string' ? args.key_arn : null,
    encryption_context_ref: contextRef(args.encryption_context),
    pod_uid: checkpoint.pod_uid,
    service_account_id: checkpoint.service_account_id,
    template_id: checkpoint.template_id,
    resource: checkpoint.object_ref,
    object_version: checkpoint.object_version,
    encrypted_data_key_ref: checkpoint.encrypted_data_key_ref,
    broker_snapshot_ref: brokerSnapshotRef,
    key_policy_snapshot_ref: keyPolicySnapshotRef,
    causal_ref: checkpoint.event_id,
  });
  const projectedValid = verifyToken(world, checkpoint.projected_token, {
    issuer: account.oidc.issuer,
    subject: account.oidc.sub,
    audience: 'broker.internal',
    bound_pod_uid: checkpoint.pod_uid,
    service_account_id: account.id,
    job_uid: checkpoint.job_uid,
  });
  const checkpointValid =
    args.checkpoint_ref === checkpoint.ref &&
    checkpoint.job_uid === world.job?.uid &&
    checkpoint.pod_uid === world.events.find((item) => item.kind === 'pod-started')?.pod_uid &&
    world.auth?.principal === world.principal &&
    world.job?.auth_context_ref === world.auth.event_id &&
    projectedValid;
  const brokerOutcome = checkpointValid
    ? brokerDecision(world, selected, checkpoint, brokerSnapshot.policy)
    : 'checkpoint-denied';
  const tokenRef =
    brokerOutcome === 'completed' ? jobId(world, 'broker-token', attempt.event_id) : null;
  const tokenClaims = tokenRef
    ? {
        issuer: brokerSnapshot.policy.issuer,
        subject: account.oidc.sub,
        audience: selected.audience,
        bound_pod_uid: checkpoint.pod_uid,
        service_account_id: account.id,
        job_uid: checkpoint.job_uid,
        checkpoint_ref: checkpoint.ref,
        profile_id: selected.id,
      }
    : null;
  const issuedToken = tokenClaims ? signToken(world, tokenClaims) : null;
  const issue = emit(world, 'broker-token-issued', {
    actor: 'workload-token-broker',
    profile_id: attempt.profile_id,
    ...(tokenRef ? { token_ref: tokenRef } : {}),
    issuer: tokenClaims?.issuer ?? null,
    subject: tokenClaims?.subject ?? null,
    audience: tokenClaims?.audience ?? null,
    bound_pod_uid: tokenClaims?.bound_pod_uid ?? null,
    outcome: tokenRef ? 'completed' : 'denied',
    ...(tokenRef ? {} : { reason: brokerOutcome }),
    causal_ref: attempt.event_id,
  });
  const commonLedger = {
    resume_attempt_event_id: attempt.event_id,
    broker_issue_event_id: issue.event_id,
    profile_id: attempt.profile_id,
    key_arn: attempt.key_arn,
    encryption_context_ref: attempt.encryption_context_ref,
    broker_snapshot_ref: brokerSnapshotRef,
    key_policy_snapshot_ref: keyPolicySnapshotRef,
  };
  if (!tokenRef) {
    return denyResume(world, brokerOutcome, commonLedger);
  }
  const tokenValid = verifyToken(world, issuedToken, tokenClaims);
  const trust = tokenValid
    ? trustDecision(world, selected, checkpoint, brokerSnapshot.policy)
    : 'decrypt-sts-denied';
  const decryptAccessKeyRef =
    trust === 'completed' ? jobId(world, 'kms-akref', issue.event_id) : null;
  const sts = emit(world, 'sts-assume-kms-web-identity', {
    actor: account.name,
    profile_id: selected.id,
    token_ref: tokenRef,
    role_arn: selected.decrypt_role_arn,
    issuer: tokenClaims.issuer,
    subject: tokenClaims.subject,
    audience: tokenClaims.audience,
    bound_pod_uid: tokenClaims.bound_pod_uid,
    session_policy_ref: selected.session_policy.ref,
    ...(decryptAccessKeyRef ? { access_key_ref: decryptAccessKeyRef } : {}),
    outcome: decryptAccessKeyRef ? 'completed' : 'denied',
    ...(decryptAccessKeyRef ? {} : { reason: trust }),
    causal_ref: issue.event_id,
  });
  if (!decryptAccessKeyRef) {
    return denyResume(world, trust, { ...commonLedger, sts_event_id: sts.event_id });
  }
  const kmsRequest = emit(world, 'kms-decrypt-request', {
    actor: selected.decrypt_role_arn,
    access_key_ref: decryptAccessKeyRef,
    action: KMS_ACTION,
    resource: checkpoint.object_ref,
    key_arn: attempt.key_arn,
    encryption_context_ref: attempt.encryption_context_ref,
    object_version: checkpoint.object_version,
    encrypted_data_key_ref: checkpoint.encrypted_data_key_ref,
    cloud_read_ref: checkpoint.cloud_read_event_id,
    causal_ref: sts.event_id,
  });
  const request = { key_arn: args.key_arn, encryption_context: args.encryption_context };
  let kmsDecision = decryptDecision(world, selected, checkpoint, request, {
    brokerPolicy: brokerSnapshot.policy,
    keyPolicy: keyPolicySnapshot,
  });
  let value = null;
  if (kmsDecision === 'completed') {
    try {
      value = decryptObject(world, checkpoint.record_snapshot);
    } catch {
      kmsDecision = 'kms-integrity-denied';
    }
  }
  const kms = emit(world, 'kms-decrypt', {
    actor: selected.decrypt_role_arn,
    access_key_ref: decryptAccessKeyRef,
    action: KMS_ACTION,
    resource: checkpoint.object_ref,
    key_arn: attempt.key_arn,
    encryption_context_ref: attempt.encryption_context_ref,
    object_version: checkpoint.object_version,
    encrypted_data_key_ref: checkpoint.encrypted_data_key_ref,
    outcome: kmsDecision === 'completed' ? 'completed' : 'denied',
    ...(kmsDecision === 'completed' ? {} : { reason: kmsDecision }),
    cloud_read_ref: checkpoint.cloud_read_event_id,
    causal_ref: kmsRequest.event_id,
  });
  const restLedger = {
    ...commonLedger,
    sts_event_id: sts.event_id,
    kms_request_event_id: kmsRequest.event_id,
    kms_event_id: kms.event_id,
    access_key_ref: decryptAccessKeyRef,
    cloud_read_event_id: checkpoint.cloud_read_event_id,
  };
  if (kmsDecision !== 'completed') {
    return denyResume(world, kmsDecision, restLedger);
  }
  const artifactRef = jobId(world, 'artifact', checkpoint.pod_uid);
  const artifact = emit(world, 'job-artifact-created', {
    actor: account.name,
    pod_uid: checkpoint.pod_uid,
    artifact_ref: artifactRef,
    causal_ref: kms.event_id,
  });
  world.artifact = {
    ref: artifactRef,
    job_uid: checkpoint.job_uid,
    pod_uid: checkpoint.pod_uid,
    value,
    created_event_id: artifact.event_id,
  };
  world.job.outcome = 'completed';
  world.ledger.push({
    kind: 'job-resume',
    job_uid: checkpoint.job_uid,
    pod_uid: checkpoint.pod_uid,
    checkpoint_ref: checkpoint.ref,
    outcome: 'completed',
    artifact_ref: artifactRef,
    ...restLedger,
  });
  return { ok: true, status: 'completed', artifact_ref: artifactRef };
}

function readArtifact(world, args) {
  if (!world.artifact || args.artifact_ref !== world.artifact.ref) {
    return { ok: false, reason: 'no-such-artifact' };
  }
  const auth = world.auth;
  if (!auth || auth.principal !== world.principal || !auth.scopes.includes('read:job-artifact')) {
    return { ok: false, reason: 'artifact-read-denied' };
  }
  world.artifactRead = true;
  const event = emit(world, 'job-artifact-read', {
    actor: world.principal,
    artifact_ref: world.artifact.ref,
    outcome: 'completed',
    causal_ref: world.artifact.created_event_id,
  });
  world.ledger.push({
    kind: 'artifact-read',
    actor: world.principal,
    artifact_ref: world.artifact.ref,
    event_id: event.event_id,
    outcome: 'completed',
  });
  return { ok: true, value: world.artifact.value };
}

export function stepJob(world, command) {
  if (
    !command ||
    typeof command !== 'object' ||
    Array.isArray(command) ||
    typeof command.tool !== 'string'
  ) {
    return { ok: false, reason: 'invalid-command' };
  }
  const args =
    command.args && typeof command.args === 'object' && !Array.isArray(command.args)
      ? command.args
      : {};
  if (world.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (command.tool === 'submit-job') {
    return submitJob(world, args);
  }
  if (command.tool === 'run-job') {
    return runJob(world, args);
  }
  if (command.tool === 'resume-job') {
    return resumeJob(world, args);
  }
  if (command.tool === 'read-job-artifact') {
    return readArtifact(world, args);
  }
  if (command.tool === 'submit') {
    world.finished = true;
    world.submitted = typeof args.value === 'string' ? args.value : null;
    return {
      ok: world.artifactRead && world.submitted === world.releaseWorld.evaluator.marker,
      status: 'submitted',
    };
  }
  if (PRE_READS.has(command.tool)) {
    world.preReads += 1;
    world.reads += 1;
    if (world.preReads > 17) {
      return { ok: false, reason: 'read-budget-exhausted' };
    }
    switch (command.tool) {
      case 'list-service-accounts':
        return { ok: true, value: world.serviceAccounts.map(({ id, name }) => ({ id, name })) };
      case 'get-service-account': {
        const account = world.serviceAccounts.find(
          (item) => item.id === (args.service_account_id ?? args.id),
        );
        return account
          ? { ok: true, value: structuredClone(account) }
          : { ok: false, reason: 'no-such-service-account' };
      }
      case 'list-templates':
        return { ok: true, value: world.templates.map(({ id, name }) => ({ id, name })) };
      case 'get-template': {
        const template = world.templates.find((item) => item.id === (args.template_id ?? args.id));
        return template
          ? { ok: true, value: structuredClone(template) }
          : { ok: false, reason: 'no-such-template' };
      }
      case 'get-job-policy':
        return { ok: true, value: structuredClone(world.policy) };
      case 'get-tenant-route':
        return { ok: true, value: structuredClone(world.tenantRoute) };
    }
  }
  if (POST_READS.has(command.tool)) {
    if (!world.checkpoint) {
      return { ok: false, reason: 'checkpoint-required' };
    }
    world.postReads += 1;
    world.reads += 1;
    if (world.postReads > 11) {
      return { ok: false, reason: 'read-budget-exhausted' };
    }
    switch (command.tool) {
      case 'list-broker-profiles':
        return { ok: true, value: world.profiles.map(({ id, name }) => ({ id, name })) };
      case 'get-broker-profile': {
        const profile = world.profiles.find((item) => item.id === (args.profile_id ?? args.id));
        return profile
          ? { ok: true, value: structuredClone(profile) }
          : { ok: false, reason: 'no-such-profile' };
      }
      case 'get-broker-policy':
        return { ok: true, value: structuredClone(world.brokerPolicy) };
      case 'get-key-policy':
        return { ok: true, value: structuredClone(world.decryptKeyPolicy) };
      case 'get-object-metadata': {
        const record = world.objectRecords[args.object_ref];
        return record
          ? {
              ok: true,
              value: {
                object_ref: record.object_ref,
                version: record.version,
                tenant_id: record.tenant_id,
                encrypted_data_key_ref: record.encrypted_data_key_ref,
                ciphertext_ref: record.ciphertext_ref,
                wrapping_key_id: record.wrapping_key_id,
                encryption_context_ref: record.encryption_context_ref,
              },
            }
          : { ok: false, reason: 'no-such-object' };
      }
    }
  }
  return { ok: false, reason: 'unknown-tool' };
}
