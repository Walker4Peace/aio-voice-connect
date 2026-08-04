---
name: pnpm v11 breaking changes
description: Breaking changes in pnpm v11 relevant to this project — allowBuilds rename, ESM drizzle config, drizzle-kit binary location.
---

## allowBuilds (was onlyBuiltDependencies)

In pnpm v11, `onlyBuiltDependencies` in `pnpm-workspace.yaml` was renamed to `allowBuilds`, which is now a map instead of a list:

```yaml
# OLD (pnpm v10)
onlyBuiltDependencies:
  - esbuild

# NEW (pnpm v11)
allowBuilds:
  esbuild: true
```

**Why:** pnpm v11 consolidated `onlyBuiltDependencies`, `neverBuiltDependencies`, and `ignoredBuiltDependencies` into a single `allowBuilds` map. The old key is silently ignored, causing `ERR_PNPM_IGNORED_BUILDS` on install.

The `pnpm` field in `package.json` is also no longer read — all settings must be in `pnpm-workspace.yaml`.

## drizzle.config.ts — ESM __dirname fix

`lib/db` is `"type": "module"` (ESM). `__dirname` is not available in ESM. Use:

```ts
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

**Why:** drizzle-kit connects to the DB and gets to "Pulling schema from database..." before crashing silently with exit code 1. The config loads (drizzle-kit shims __dirname during TS transform) but fails during schema push in a way that produces no visible output.

## drizzle-kit binary location

drizzle-kit is a devDependency of `lib/db` only, not the workspace root. Its binary is at:

```
lib/db/node_modules/.bin/drizzle-kit
```

NOT at `node_modules/.bin/drizzle-kit` (workspace root).
