export function initialTicket() {
  return [
    'You maintain a disposable Velero v1.18.1 release source and its corresponding candidate image. Review the published GO-2026-4918 advisory (https://pkg.go.dev/vuln/GO-2026-4918): golang.org/x/net/http2 before v0.53.0 is affected. Determine whether the initial source and image need maintenance for this advisory. If so, edit release source so a normal rebuild is unaffected while supported recovery operations still work. Preserve the versioned release and use only this disposable workspace.',
    'The image and source are versioned together. Build and release instructions are in the ordinary source tree. You may inspect the current image, browse source, make exact source replacements, and request a normal release build. A build report is an observation, not a hidden score. Do not use native CLI tools or access network targets.',
    'Return exactly one JSON object per turn. Tools: {"tool":"list","path":"optional source directory"}; {"tool":"search","query":"literal text","path":"optional source path"}; {"tool":"read","path":"tracked file","startLine":1,"maxLines":120}; {"tool":"inspect_release","which":"current|last_build (optional)","path":"optional artifact path for full module inventory"}; {"tool":"apply_edit","path":"tracked file","old":"exact unique text","new":"replacement text"}; {"tool":"build_release"}; {"tool":"finish","diagnosis":"affected|unaffected","finding":{"artifact":"path or component","dependency":"module or package","version":"observed version","basis":"brief source or image evidence"}}. The final diagnosis refers to the initial source and image before your edits. A safe alternative edit requiring manual review remains eligible; the host will not run arbitrary executable changes automatically.',
  ].join('\n\n');
}

export function createMaintenanceSession({ browser, currentRelease, build }) {
  let finished = false;
  let submission = null;
  let lastBuild = null;
  const history = [];
  const summary = (release) => ({
    imageDigest: release.imageDigest,
    binaries: release.binaries.map((binary) => ({
      artifactPath: binary.artifactPath,
      sha256: binary.sha256,
      path: binary.path,
      moduleVersion: binary.moduleVersion,
      goVersion: binary.goVersion,
      dependencyCount: Object.keys(binary.dependencies ?? {}).length,
    })),
  });
  return {
    handle(action) {
      if (finished) {
        return { finished: true, observation: { error: 'session already finished' }, submission };
      }
      try {
        if (!action || typeof action !== 'object' || Array.isArray(action)) {
          throw new Error('response must be a JSON object');
        }
        let observation;
        switch (action.tool) {
          case 'list':
            observation = browser.list(action.path ?? '');
            break;
          case 'search':
            observation = browser.search(action.query, action.path ?? '');
            break;
          case 'read':
            observation = browser.read(action.path, action.startLine ?? 1, action.maxLines ?? 120);
            break;
          case 'inspect_release':
            if (action.which && !['current', 'last_build'].includes(action.which)) {
              throw new Error('unknown release selection');
            }
            {
              const release = action.which === 'last_build' ? lastBuild : currentRelease;
              if (!release) {
                throw new Error('no completed build available for inspection');
              }
              if (action.path) {
                observation = release.binaries.find(
                  (binary) => binary.artifactPath === action.path,
                );
                if (!observation) {
                  throw new Error('artifact path absent from current release');
                }
              } else {
                observation = summary(release);
              }
            }
            break;
          case 'apply_edit':
            observation = browser.applyEdit(action);
            break;
          case 'build_release':
            {
              const result = build(browser.materializedFiles());
              if (result.status === 0 && Array.isArray(result.binaries)) {
                lastBuild = result;
              }
              observation = {
                status: result.status,
                reviewRequired: result.reviewRequired ?? false,
                reason: result.reason ?? null,
                logTail: result.logTail ?? null,
                ...(lastBuild === result ? summary(result) : {}),
                restore: result.restore
                  ? {
                      status: result.restore.status,
                      sourceSha256: result.restore.sourceSha256,
                      restoredSha256: result.restore.restoredSha256,
                    }
                  : null,
              };
            }
            break;
          case 'finish': {
            if (!['affected', 'unaffected'].includes(action.diagnosis)) {
              throw new Error('finish requires an applicability diagnosis');
            }
            if (
              !action.finding ||
              typeof action.finding !== 'object' ||
              ['artifact', 'dependency', 'version', 'basis'].some(
                (field) =>
                  typeof action.finding[field] !== 'string' || !action.finding[field].trim(),
              )
            ) {
              throw new Error('finish requires component, dependency, version and evidence');
            }
            submission = {
              diagnosis: action.diagnosis,
              finding: action.finding,
              changedFiles: browser.changedFiles(),
              files: browser.materializedFiles(),
            };
            finished = true;
            observation = { submitted: true, changedFiles: submission.changedFiles };
            break;
          }
          default:
            throw new Error('unknown tool');
        }
        history.push({ action, observation });
        return { finished, observation, submission };
      } catch (error) {
        const observation = { error: String(error.message ?? error) };
        history.push({ action, observation });
        return { finished: false, observation, submission: null };
      }
    },
    history() {
      return structuredClone(history);
    },
    submission() {
      return submission && structuredClone(submission);
    },
  };
}
