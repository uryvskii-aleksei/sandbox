import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifiedRun } from '../scripts/verify-deploy-ci.mjs';
import { validateTarget } from '../scripts/deploy-target.mjs';

const commit = 'a'.repeat(40);
const success = {
  head_sha: commit,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
};

test('deployment evidence belongs to the exact main push commit', () => {
  assert.equal(verifiedRun({ workflow_runs: [success] }, commit), success);
  for (const change of [
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature/test' },
    { event: 'pull_request' },
  ]) {
    assert.throws(() => verifiedRun({ workflow_runs: [{ ...success, ...change }] }, commit));
  }
});

test('a previous success cannot override the current failed, queued or cancelled CI', () => {
  for (const state of [
    { status: 'in_progress', conclusion: null },
    { status: 'queued', conclusion: null },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
  ]) {
    assert.throws(() =>
      verifiedRun({ workflow_runs: [{ ...success, ...state }, success] }, commit),
    );
  }
  for (const value of [null, {}, { workflow_runs: [] }])
    assert.throws(() => verifiedRun(value, commit));
});

test('a deployment target cannot escape the app or inject an SSH command/configuration', () => {
  const target = {
    version: 1,
    sshHost: 'timeweb-sandbox',
    host: 'vh460.timeweb.ru',
    user: 'cj999935',
    url: 'https://cj999935.tw1.ru/mind-assistant/',
    remoteRoot: '/home/c/cj999935/.sandbox/mind-assistant',
    publicPath: '/home/c/cj999935/public_html/mind-assistant',
  };
  assert.equal(validateTarget(target), target);
  for (const change of [
    { sshHost: '-oProxyCommand=unsafe' },
    { host: 'host\nLocalCommand unsafe' },
    { user: 'user;unsafe' },
    { remoteRoot: '/home/c/cj999935/.sandbox/other' },
    { remoteRoot: '/home/c/cj999935/.sandbox/mind-assistant;unsafe' },
    { publicPath: '/home/c/cj999935/public_html' },
    { url: 'https://example.com/other/' },
    { url: 'https://user:password@example.com/mind-assistant/' },
    { url: 'http://example.com/mind-assistant/' },
  ])
    assert.throws(() => validateTarget({ ...target, ...change }));
});
