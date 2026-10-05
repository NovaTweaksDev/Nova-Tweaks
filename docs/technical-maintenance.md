# Technical maintenance changes

## Timeout

`executionTimeout.js` defines a single 60-second fallback and validates integer budgets from 1 to 300000 ms. Renderer and both IPC execution routes preserve missing values. Catalog normalization preserves the original configured value so invalid data cannot become a valid default silently. Detection receives its own configured budget. The administrator broker retains its independent protocol limit.

## Restore

`restoreService.js` orchestrates Nova restores using the existing BackupManager, TweakRunner, SettingsService and admin broker. The renderer submits only backup identity and scopes; existing `backup:restore` stays available for preparation and Windows restore points.

New channels: `backup:restore:start`, `backup:restore:resume`, `backup:restore:status`, `backup:restore:list`, and `backup:restore:update`. Start/resume return a job identity; events and status return step progress and the resulting scopes/errors/restart requirement. No execution token crosses IPC.

The journal is stored under userData/restore-journal. Each write uses an exclusive temporary file, fsync and atomic replacement. A started entry must be saved before changing settings or executing a tweak. The first error stops execution without rollback. Resume is explicit, re-reads the backup, compares the source content/configuration/script fingerprints, rebuilds parameters and verifies live target states. Detection fallbacks are blocked. Successful scripts are checked again before recording completion.

Partial backup sections can restore their captured entries, but are never reported as completely restored scopes. Unavailable sections block preflight. Stateless fixes and one-shot actions retain their previous no-replay behavior. Settings, theme and language are persisted through SettingsService. The central execution gate rejects concurrent tweak callers, including automatic rules, and refuses to start a restore while a tweak is in flight.

## Responsibility boundaries and checks

Registration moved from main.js to settings, backup, apps, monitoring and tweak modules under electron/ipc. Accessors preserve live main-process state. Only identical normalization functions were shared in metadataNormalization.js. Renderer settings, app loading, monitoring settings, tweak catalog and restore actions are grouped in src/hooks.

shared/desktopContracts.d.ts and tsconfig.contracts.json check the timeout/gate, restore IPC adapter and restore hooks without migrating the Electron build pipeline. Preload tweak parameters reference the same contracts through JSDoc. ESLint checks undefined identifiers, unreachable code, duplicate keys and hook placement without reformatting the codebase.

CI and releases run lint, interface type checking, tests and packaging. The smoke test starts the package with isolated temporary user data, verifies required helper resources and loads the actual dashboard with system operations disabled. Release notes use the exact tagged changelog section and fail for missing, duplicate or empty sections. Installers remain explicitly unsigned.

## Validation commands

- npm run lint
- npm run typecheck
- npm test
- npm run build
- npm run dist:local:dir
- npm run test:packaged

Actual UAC interaction, system mutations and manual restore UI verification require the disposable VM scenarios in windows-vm-validation.md. The smoke test and injected regression tests are not evidence of compatibility across Windows builds. TweakDetailPanel, tweak evidence fields and displayed restore semantics were not changed.
