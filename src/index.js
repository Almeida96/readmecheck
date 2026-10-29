import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { parseMarkdown } from './markdown.js';
export { parseMarkdown } from './markdown.js';

const within = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const display = path => path.split(sep).join('/');
const MAX_BYTES = 2 * 1024 * 1024;

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Configuration must be a JSON object.');
  for (const key of Object.keys(value)) if (!['requireHeadings', 'ignoreLinks'].includes(key)) throw new TypeError(`Unknown configuration key: ${key}`);
  for (const key of ['requireHeadings', 'ignoreLinks']) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(v => typeof v !== 'string' || !v.trim()))) throw new TypeError(`${key} must contain nonempty strings.`);
  }
  return { requireHeadings: value.requireHeadings ?? [], ignoreLinks: value.ignoreLinks ?? [] };
}

/** Local checks only. Does not fetch URLs, execute Markdown, or modify files. */
export async function checkFiles(files = ['README.md'], { root = process.cwd(), config = {} } = {}) {
  const rules = validateConfig(config);
  if (!Array.isArray(files) || !files.length || files.length > 2000 || files.some(file => typeof file !== 'string' || !file)) throw new TypeError('Provide 1–2,000 Markdown file paths.');
  const rootPath = resolve(root), physicalRoot = await realpath(rootPath);
  const cache = new Map(), paths = new Map(), issues = [];
  let checked = 0, skipped = 0;
  async function inspect(path) {
    if (paths.has(path)) return paths.get(path);
    const promise = (async () => {
      if (!within(rootPath, path)) return { code: 'outside-root', message: 'Path leaves the configured root.' };
      let current = rootPath, mismatch = false;
      try {
        for (const part of relative(rootPath, path).split(sep).filter(Boolean)) {
          const names = await readdir(current);
          const actual = names.includes(part) ? part : names.find(name => name.toLowerCase() === part.toLowerCase());
          if (!actual) return { code: 'missing-path', message: 'Local target does not exist.' };
          mismatch ||= actual !== part;
          current = resolve(current, actual);
          if (!within(physicalRoot, await realpath(current))) return { code: 'outside-root', message: 'Symlink target leaves the configured root.' };
        }
        const info = await stat(current);
        if (mismatch) return { code: 'path-case', message: `Path case differs from disk: ${display(relative(rootPath, current))}` };
        return { path: current, info };
      } catch { return { code: 'unreadable-path', message: 'Local target could not be read.' }; }
    })();
    paths.set(path, promise); return promise;
  }
  async function document(path) {
    if (!cache.has(path)) cache.set(path, (async () => {
      const found = await inspect(path);
      if (found.code) throw new Error(found.message);
      if (!found.info.isFile() || found.info.size > MAX_BYTES) throw new Error('Markdown must be a regular file no larger than 2 MiB.');
      return parseMarkdown(await readFile(path, 'utf8'));
    })());
    return cache.get(path);
  }
  for (const file of [...new Set(files)].sort()) {
    const path = resolve(rootPath, file), name = display(relative(rootPath, path));
    const add = (code, message, link = {}) => issues.push({ file: name, line: link.line ?? 1, column: link.column ?? 1, code, message, ...(link.target !== undefined ? { target: link.target } : {}) });
    let doc;
    try { doc = await document(path); }
    catch (error) { add('document-read', error.message); continue; }
    const headingNames = new Set(doc.headings.map(text => text.trim().toLowerCase()));
    for (const heading of rules.requireHeadings) if (!headingNames.has(heading.trim().toLowerCase())) add('required-heading', `Missing required heading: ${heading}`);
    for (const link of doc.links) {
      const url = link.target;
      if (rules.ignoreLinks.includes(url)) { skipped++; continue; }
      if (/^(?:https?:|mailto:|tel:)/i.test(url) || url.startsWith('//')) { skipped++; continue; }
      if (/^[a-z][a-z\d+.-]*:/i.test(url)) { add('unsupported-protocol', 'Unsupported link protocol.', link); continue; }
      if (!url) { skipped++; continue; }
      checked++;
      let pathname, hash;
      try {
        const hashIndex = url.indexOf('#');
        hash = hashIndex < 0 ? '' : decodeURIComponent(url.slice(hashIndex + 1));
        pathname = decodeURIComponent((hashIndex < 0 ? url : url.slice(0, hashIndex)).split('?')[0]);
        if (pathname.includes('\0') || pathname.includes('\\')) throw new Error();
      } catch { add('invalid-target', 'Malformed URL encoding or nonportable path.', link); continue; }
      const target = pathname ? resolve(pathname.startsWith('/') ? rootPath : dirname(path), pathname.replace(/^\/+/, '')) : path;
      const found = await inspect(target);
      if (found.code) { add(found.code, found.message, link); continue; }
      if (hash && /\.(md|markdown)$/i.test(target) && found.info.isFile()) {
        try {
          if (!(await document(target)).anchors.has(hash)) add('missing-anchor', `Heading or HTML anchor #${hash} was not found.`, link);
        } catch (error) { add('target-read', error.message, link); }
      }
    }
  }
  issues.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code, 'en'));
  return { schemaVersion: 1, ok: issues.length === 0, files: new Set(files).size, checkedLinks: checked, skippedLinks: skipped, issues };
}
