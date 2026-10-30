# Contributing

Use Node.js 22+ and the pnpm version in package.json. Install with `pnpm install --frozen-lockfile`, then run `pnpm test`, `pnpm run check` and `pnpm run pack:check`.

Markdown parsing and link resolution are separate. Add a temporary-directory fixture for a resolver change, and test filename case on both Windows and Linux. External links must remain offline; a check must never fetch a URL from a document.

Preserve CLI exit codes and structured findings. Test traversal, percent encoding and symlink boundaries when changing path handling. Diagnostics printed as GitHub annotations must escape workflow control characters.

Use a concrete broken-link example in a bug report, with the expected file location and operating system.
