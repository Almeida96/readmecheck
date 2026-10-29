import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { checkFiles, parseMarkdown, validateConfig } from '../src/index.js';

const cli = fileURLToPath(new URL('../bin/readmecheck.js', import.meta.url));
async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'readmecheck-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) { await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), content); }
  return root;
}

test('parses reference links, images, GFM tables and HTML attributes with source locations', () => {
  const doc = parseMarkdown('# Demo\n\n[guide][g]\n\n[g]: docs/guide.md\n\n| Image |\n| --- |\n| ![pic](pic.png) |\n\n<a id="custom" href="other.md">Link</a>\n<img src="photo&amp;icon.png">');
  assert.deepEqual(doc.links.map(l => l.target), ['docs/guide.md', 'pic.png', 'other.md', 'photo&icon.png']);
  assert.equal(doc.links[0].line, 3);
  assert.equal(doc.links[2].line, 11);
  assert.ok(doc.anchors.has('custom'));
});
test('ignores code and frontmatter, and generates duplicate and Unicode anchors', () => {
  const doc = parseMarkdown('---\nurl: missing.md\n---\n# Café\n## Use `npm`\n## Use `npm`\n\n`[no](bad.md)`\n\n```md\n[no](bad.md)\n```');
  assert.equal(doc.links.length, 0);
  assert.deepEqual([...doc.anchors], ['café', 'use-npm', 'use-npm-1']);
});
test('checks references, encoded paths, root paths and anchors in other documents', async t => {
  const root = await fixture(t, { 'README.md': '# Root\n[guide](docs/Guide%20One.md#use-it)\n![pic](/assets/a.png)\n[local](#root)', 'docs/Guide One.md': '## Use it', 'assets/a.png': 'fixture' });
  assert.equal((await checkFiles(['README.md'], { root })).ok, true);
});
test('reports missing paths, wrong case and missing anchors on every platform', async t => {
  const root = await fixture(t, { 'README.md': '# Root\n[bad](missing.md)\n[case](guide.md)\n[anchor](Guide.md#wrong)', 'Guide.md': '# Present' });
  const result = await checkFiles(['README.md'], { root });
  assert.deepEqual(result.issues.map(x => [x.line, x.code]), [[2, 'missing-path'], [3, 'path-case'], [4, 'missing-anchor']]);
});
test('checks links inside nested Markdown relative to their own directory', async t => {
  const root = await fixture(t, { 'docs/guide.md': '[root](../README.md#root)\n[image](../assets/icon.svg?raw=1)', 'README.md': '# Root', 'assets/icon.svg': '<svg/>' });
  assert.equal((await checkFiles(['docs/guide.md'], { root })).ok, true);
});
test('checks HTML IDs and legacy named anchors', async t => {
  const root = await fixture(t, { 'README.md': '[one](#custom) [two](#legacy)\n\n<div id="custom"></div>\n<a name="legacy"></a>' });
  assert.equal((await checkFiles(['README.md'], { root })).ok, true);
});
test('does not fetch external targets and rejects unsupported protocols', async t => {
  const root = await fixture(t, { 'README.md': '[web](https://does-not-exist.invalid) [email](mailto:a@example.test) [cdn](//example.invalid/a) [bad](javascript:alert)' });
  const result = await checkFiles(['README.md'], { root });
  assert.equal(result.skippedLinks, 3); assert.equal(result.issues[0].code, 'unsupported-protocol');
});
test('rejects traversal, malformed encodings and backslash paths', async t => {
  const root = await fixture(t, { 'README.md': '[outside](../private.md) [encoded](%2e%2e/private.md) [bad](bad%ZZ.md) [windows](docs%5Cfile.md)' });
  assert.deepEqual((await checkFiles(['README.md'], { root })).issues.map(x => x.code), ['outside-root', 'outside-root', 'invalid-target', 'invalid-target']);
});
test('does not follow a symlink outside the configured root', async t => {
  const root = await fixture(t, { 'README.md': '[secret](linked/private.md)' });
  const outside = await fixture(t, { 'private.md': 'private fixture' });
  await symlink(outside, join(root, 'linked'), 'junction');
  assert.equal((await checkFiles(['README.md'], { root })).issues[0].code, 'outside-root');
});
test('configuration checks headings and ignores only exact declared links', async t => {
  const root = await fixture(t, { 'README.md': '# App\n## **Usage**\n[generated](generated.md) [missing](other.md)' });
  const result = await checkFiles(['README.md'], { root, config: { requireHeadings: ['Usage', 'License'], ignoreLinks: ['generated.md'] } });
  assert.deepEqual(result.issues.map(x => x.code), ['required-heading', 'missing-path']);
  assert.equal(result.skippedLinks, 1);
  for (const config of [[], { ignore: [] }, { requireHeadings: [4] }, { ignoreLinks: [''] }]) assert.throws(() => validateConfig(config));
});
test('bounds document size and rejects a directory as input', async t => {
  const root = await fixture(t, { 'README.md': 'x'.repeat(2 * 1024 * 1024 + 1) });
  assert.equal((await checkFiles(['README.md', '.'], { root })).issues.length, 2);
});
test('CLI returns structured findings and distinguishes invalid configuration', async t => {
  const root = await fixture(t, { 'README.md': '[broken](missing.png)' });
  const result = spawnSync(process.execPath, [cli, '--root', root, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).issues[0].code, 'missing-path');
  await writeFile(join(root, '.readmecheck.json'), '{broken');
  const invalid = spawnSync(process.execPath, [cli, '--root', root, '--format', 'json'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2); assert.match(JSON.parse(invalid.stdout).error, /Configuration/);
});
test('CLI --all checks tracked Markdown and excludes untracked drafts', async t => {
  const root = await fixture(t, { 'README.md': '# Working', 'draft.md': '[broken](missing)' });
  execFileSync('git', ['init', '--quiet'], { cwd: root }); execFileSync('git', ['add', 'README.md'], { cwd: root });
  const result = spawnSync(process.execPath, [cli, '--root', root, '--all', '--format', 'json'], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).files, 1);
});
test('GitHub annotations escape workflow control characters', async t => {
  const root = await fixture(t, { 'README.md': '[broken](missing%0A%3A%3Aerror.md)' });
  const result = spawnSync(process.execPath, [cli, '--root', root, '--format', 'github'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout.split('\n').filter(line => line.startsWith('::error')).length, 1);
  assert.match(result.stdout, /file=README.md,line=1,col=1/);
});
test('CLI rejects unknown and repeated options and supports help without files', () => {
  for (const args of [['--wat'], ['--all', 'README.md'], ['--format', 'yaml'], ['--all', '--all'], ['--root']]) assert.equal(spawnSync(process.execPath, [cli, ...args]).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0);
});
