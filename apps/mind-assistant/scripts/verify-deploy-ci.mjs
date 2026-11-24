export { verifiedRun, verifyCi } from '../../../scripts/lib/github-ci.mjs';

export function isReleaseReady(release, commit, digest) {
  return Boolean(
    release &&
    release.version === 1 &&
    release.app === 'mind-assistant' &&
    release.commit === commit &&
    release.artifactSha256 === digest &&
    release.deploymentStatus === 'ready',
  );
}
