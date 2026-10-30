# ReadmeCheck

[![CI](https://github.com/Almeida96/readmecheck/actions/workflows/ci.yml/badge.svg)](https://github.com/Almeida96/readmecheck/actions/workflows/ci.yml)

Find broken local links, missing images, wrong filename case, and stale heading anchors in Markdown before pushing to GitHub. Runs offline and reports the file, line, and column of each finding.

## Install

Requires Node.js 22 or later. Build from this repository:

```sh
git clone https://github.com/Almeida96/readmecheck.git
cd readmecheck
pnpm install --frozen-lockfile
pnpm pack --out readmecheck-0.1.0.tgz
npm install --global ./readmecheck-0.1.0.tgz
```

You can also run `node bin/readmecheck.js` from the checkout after installing dependencies. The package is not published to the npm registry.

## Usage

```sh
readmecheck
readmecheck README.md docs/setup.md
readmecheck --root ../my-project --all
readmecheck --format json
```

Paths are relative to `--root`, which defaults to the current directory. Without file arguments, the command checks `README.md`. `--all` checks Markdown files tracked by Git, including staged new files; it excludes untracked drafts. It requires Git and cannot be combined with explicit file paths.

For a README linking to an image that was renamed:

```text
README.md:12:1 [missing-path] Local target does not exist. (docs/old-preview.png)
FAIL: 1 file(s), 1 local link(s), 1 finding(s). 0 external or ignored link(s) skipped.
```

Exit codes: `0` means passed, `1` means findings, and `2` means invalid arguments, unreadable configuration, or a setup error. A missing input Markdown file is a finding. JSON output includes `schemaVersion: 1`, `ok`, counts, and an `issues` array; setup errors instead include an `error` string.

## What is checked

- Inline and reference Markdown links and images, including links inside GFM tables.
- Relative paths, repository-root paths, spaces encoded as `%20`, and URL query strings.
- Exact filename case on Windows as well as Linux and macOS.
- Heading fragments in the same or another Markdown file, including duplicate headings and Unicode slugs.
- HTML `href` and media `src` attributes, explicit `id` anchors, and named `<a>` anchors.
- Optional required headings and exact-link exclusions from configuration.

Code blocks, inline code, and YAML/TOML frontmatter are not treated as links. External HTTP(S), email, telephone, and protocol-relative URLs are counted as skipped: no requests are sent. Unsupported protocols are reported. Local paths and symlinks cannot escape the configured root.

## Configuration

Create `.readmecheck.json` in the root or select a file with `--config`:

```json
{
  "requireHeadings": ["Usage", "License"],
  "ignoreLinks": ["generated/api.md"]
}
```

Required headings apply to every input document, ignoring case and inline emphasis. Leave the list empty when checking a documentation tree with different section names. Exclusions match the complete decoded Markdown destination exactly, including any query or fragment; they are not globs. Unknown options are errors so a typo cannot silently disable a check.

## GitHub Actions

After adding the packed archive as a development dependency and committing your lockfile:

```yaml
- uses: actions/checkout@v7
- uses: actions/setup-node@v7
  with:
    node-version: 22
- run: npm ci
- run: npx --no-install readmecheck --all --format github
```

The `github` reporter emits escaped error annotations at the affected source locations. Run it from the repository root. It does not request write permissions or post comments. The [project workflow](.github/workflows/ci.yml) tests Node 22 and 24 on Linux, Windows and macOS and installs the packed CLI before running it against this README.

## Library

```js
import { checkFiles } from '@almeida96/readmecheck';

const report = await checkFiles(['README.md'], {
  root: '/path/to/repository',
  config: { requireHeadings: ['Usage'] }
});

for (const issue of report.issues) {
  console.log(`${issue.file}:${issue.line} ${issue.code}: ${issue.message}`);
}
```

The library returns the same report as the JSON CLI and does not print or set exit codes. Invalid configuration or root setup rejects the promise; document and target failures become findings.

## Limits

Up to 2,000 input files, 2 MiB per Markdown document. Directory links are checked for existence. Fragments on non-Markdown files are not checked. Raw HTML headings do not generate automatic slugs; use an explicit HTML ID. `srcset`, CSS URLs, MDX expressions, undefined Markdown references, and framework routing conventions are not interpreted. It checks file links, not whether an image can be decoded or a README explains the project well.

Parsing uses [remark](https://github.com/remarkjs/remark), HTML attributes use [parse5](https://github.com/inikulin/parse5), and heading IDs use [github-slugger](https://github.com/Flet/github-slugger). This avoids treating examples inside code fences as real links.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
node bin/readmecheck.js --all
```

Tests create isolated repositories and cover reference syntax, anchors, filename case, traversal, symlinks, reports, exit codes, and tracked-file discovery. See [the contribution guide](CONTRIBUTING.md) for regression-test expectations and [the changelog](CHANGELOG.md) for releases.

## License

[MIT](LICENSE)
