#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkFiles, validateConfig } from '../src/index.js';

const help = `Usage: readmecheck [files...] [options]

Check local Markdown links, images, anchors and required headings.
Defaults to README.md. No network requests or file changes.

  --root <path>          Repository root (default: current directory)
  --all                  Check Markdown files tracked by Git under the root
  --config <path>        JSON configuration (default: .readmecheck.json if present)
  --format <format>      text, json, or github (default: text)
  --help                 Show help
  --version              Show version

Exit codes: 0 passed; 1 findings; 2 invalid arguments or configuration.
`;
const escapeData = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = value => escapeData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
process.stdout.on('error', error => { if (error.code === 'EPIPE') process.exit(0); else process.exit(2); });
let format = 'text';
try {
  const args = process.argv.slice(2), files = [], seen = new Set();
  let root = process.cwd(), configPath, all = false, positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--' && !positional) { positional = true; continue; }
    if (positional || !arg.startsWith('-')) { files.push(arg); continue; }
    if (seen.has(arg)) throw new Error(`Repeated option: ${arg}`); seen.add(arg);
    if (arg === '--help' || arg === '--version') {
      if (args.length !== 1) throw new Error(`${arg} must be used alone.`);
      process.stdout.write(arg === '--help' ? help : JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version + '\n');
      process.exit(0);
    }
    if (arg === '--all') { all = true; continue; }
    if (!['--root', '--config', '--format'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
    if (arg === '--root') root = resolve(value);
    if (arg === '--config') configPath = value;
    if (arg === '--format') format = value;
  }
  if (!['text', 'json', 'github'].includes(format)) throw new Error('Format must be text, json, or github.');
  if (all && files.length) throw new Error('Use --all or explicit file paths, not both.');
  let config = {};
  try { config = JSON.parse(await readFile(resolve(root, configPath ?? '.readmecheck.json'), 'utf8')); }
  catch (error) { if (configPath || error.code !== 'ENOENT') throw new Error('Configuration could not be read as JSON.'); }
  validateConfig(config);
  if (all) {
    let paths;
    try { paths = execFileSync('git', ['ls-files', '-z', '--cached', '--', '*.md', '*.markdown', '*.MD', '*.MARKDOWN'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { throw new Error('--all requires Git and a working repository.'); }
    files.push(...paths.split('\0').filter(Boolean));
    if (!files.length) throw new Error('No tracked Markdown files were found.');
  }
  const result = await checkFiles(files.length ? files : ['README.md'], { root, config });
  if (format === 'json') process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    for (const issue of result.issues) {
      const description = `[${issue.code}] ${issue.message}${issue.target !== undefined ? ` (${issue.target})` : ''}`;
      if (format === 'github') process.stdout.write(`::error file=${escapeProperty(issue.file)},line=${issue.line},col=${issue.column},title=${escapeProperty(issue.code)}::${escapeData(description)}\n`);
      else process.stdout.write(`${issue.file}:${issue.line}:${issue.column} ${description}\n`);
    }
    process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}: ${result.files} file(s), ${result.checkedLinks} local link(s), ${result.issues.length} finding(s). ${result.skippedLinks} external or ignored link(s) skipped.\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  if (format === 'json') process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: error.message }) + '\n');
  else process.stderr.write(`readmecheck: ${error.message}\n`);
  process.exitCode = 2;
}
