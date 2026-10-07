# AGENTS.md

## Cursor Cloud specific instructions

### Service overview

This is a static React 19 SPA (Create React App) — no backend, no database, no API. The only service to run is the Webpack dev server.

### Running the dev server

```bash
pnpm start          # http://localhost:3000
```

CRA's built-in ESLint runs automatically during compilation. A successful compile ("Compiled successfully!") means lint is also passing.

### Build

```bash
pnpm run build      # production bundle in build/
```

### Known issue: `pnpm test` fails (pre-existing)

`react-router-dom@7.14.2` uses the `exports` field and sub-path exports (`react-router/dom`) which Jest 27 (bundled with `react-scripts@5.0.1`) cannot resolve. This causes `Cannot find module 'react-router-dom'` or `TextEncoder is not defined` errors. The dev server and production build work fine because Webpack 5 supports `exports`.

This is not an environment issue — it's a dependency incompatibility that exists in the repo's lockfile and would require either upgrading react-scripts (Jest 28+) or adding Jest `moduleNameMapper` overrides to package.json.

### pnpm build scripts warning

After `pnpm install`, you will see a warning about ignored build scripts for `core-js`. This is safe to ignore — it does not affect functionality.
