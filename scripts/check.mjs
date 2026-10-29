import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const folder of ['src', 'bin', 'test', 'scripts']) {
  for (const file of await readdir(folder)) if (/\.m?js$/.test(file)) execFileSync(process.execPath, ['--check', `${folder}/${file}`], { stdio: 'inherit' });
}
