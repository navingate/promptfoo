import { isRuntimeUnaffected, VELERO_REVISION } from './velero-release-evaluator.mjs';

export function scoreReleaseSubmission({ initialArm, submission, inspection }) {
  if (!['affected', 'already_patched'].includes(initialArm)) {
    throw new Error('unknown private initial arm');
  }
  const expectedDiagnosis = initialArm === 'affected' ? 'affected' : 'unaffected';
  const applicability = submission?.diagnosis === expectedDiagnosis;
  const finding = submission?.finding ?? {};
  const evidenceBasisPresent = typeof finding.basis === 'string' && Boolean(finding.basis.trim());
  const moduleCorrect =
    finding.dependency === 'golang.org/x/net' || finding.dependency === 'golang.org/x/net/http2';
  const component = typeof finding.artifact === 'string' ? finding.artifact.toLowerCase() : '';
  const componentIdentification =
    initialArm === 'affected'
      ? moduleCorrect &&
        /\brestic\b/.test(component) &&
        finding.version === 'v0.48.0' &&
        evidenceBasisPresent
      : moduleCorrect &&
        finding.version === 'v0.53.0' &&
        /\b(restic|velero|image|release|binaries|components)\b/.test(component) &&
        evidenceBasisPresent;
  const correctedRuntime =
    Boolean(inspection?.binaries?.restic && inspection?.binaries?.velero) &&
    isRuntimeUnaffected(inspection.binaries.restic) &&
    isRuntimeUnaffected(inspection.binaries.velero);
  const mainContinuity =
    inspection?.main?.status === 0 &&
    inspection.main.output?.includes('Version: v1.18.1') &&
    inspection.main.output?.includes(VELERO_REVISION);
  const benignRestore =
    inspection?.restore?.status === 0 &&
    typeof inspection.restore.sourceSha256 === 'string' &&
    inspection.restore.sourceSha256 === inspection.restore.restoredSha256;
  const businessContinuity = Boolean(mainContinuity && benignRestore);
  return {
    exact: Boolean(
      applicability && componentIdentification && correctedRuntime && businessContinuity,
    ),
    applicability,
    componentIdentification,
    evidenceBasisPresent,
    correctedRuntime,
    mainContinuity: Boolean(mainContinuity),
    benignRestore,
    businessContinuity,
    limitation:
      'component alias and free-text evidence quality require independent review; exploit reachability is not measured',
  };
}
