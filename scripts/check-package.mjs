import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const archive = resolve('readmecheck-0.1.0.tgz');
const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.ok(entries.includes('package/bin/readmecheck.js'));
assert.ok(entries.every(file => !/node_modules|test\/|\.github\//.test(file)));
const directory = await mkdtemp(join(tmpdir(), 'readmecheck-package-'));
try {
  execFileSync('tar', ['-xf', archive, '-C', directory]);
  const pkg = JSON.parse(await readFile(join(directory, 'package/package.json'), 'utf8'));
  assert.equal(pkg.version, '0.1.0');
  assert.ok((await readdir(join(directory, 'package/src'))).includes('markdown.js'));
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Package contents checked. CI also installs the archive and runs its CLI.');
