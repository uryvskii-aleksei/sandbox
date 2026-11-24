export function verifiedRun(data, commit) {
  if (!data || !Array.isArray(data.workflow_runs)) {
    throw new Error('GitHub вернул некорректный список CI.');
  }
  const latest = data.workflow_runs.find(
    (item) =>
      item && item.head_sha === commit && item.head_branch === 'main' && item.event === 'push',
  );
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error('Последний Harness CI этого коммита main ещё не завершён успешно.');
  }
  return latest;
}

export async function verifyCi(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Нужен точный commit SHA.');
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(
    `https://api.github.com/repos/uryvskii-aleksei/sandbox/actions/workflows/harness.yml/runs?head_sha=${commit}&event=push&per_page=20`,
    { headers, signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) throw new Error(`Не удалось проверить CI: HTTP ${response.status}.`);
  const result = verifiedRun(await response.json(), commit);
  console.log(`Проверен CI коммита ${commit}: ${result.html_url}`);
}
