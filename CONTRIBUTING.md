# Contributing to Nova Tweaks

Nova Tweaks changes real Windows configuration. Contributions should be focused, reviewable, and clear about system effects. Small fixes are welcome, especially when they improve documentation, translations, tests, accessibility, or compatibility without widening the change surface.

## Getting started

1. Fork `NovaTweaksDev/Nova-Tweaks` on GitHub.
2. Create a branch from `main` with a descriptive name.
3. Install the locked dependencies with `npm ci`.
4. Start the renderer and Electron process with `npm run dev`.
5. Run `npm test` and `npm run build` before opening a pull request.

Clone your fork using the URL shown by GitHub, then create a focused branch:

```powershell
cd Nova-Tweaks
git switch -c fix/short-description
npm ci
npm run dev
```

Do not use a primary or managed Windows installation to test unfamiliar system changes. Use a recoverable test system or virtual machine when the affected feature permits it.

## Development requirements

- Windows 10 or Windows 11
- Node.js 22 and npm
- PowerShell
- Visual Studio Build Tools with C++ and CMake support when rebuilding Nova-owned native helpers
- .NET 8 SDK when rebuilding the game detector or LibreHardwareMonitor runtime

The main application and packaging targets are x64. The scripts in `package.json` are the source of truth for development, tests, builds, and local packaging.

## Types of contributions

Useful contributions include:

- Reproducible bug fixes
- Focused interface and accessibility fixes
- Documentation and release-process improvements
- English, German, or French translation corrections
- Tweak definitions and their matching PowerShell implementation
- Windows, hardware, and driver compatibility testing
- Tests for existing behavior and safety boundaries
- Small improvements to diagnostics and error reporting

Propose broad product, architecture, or dependency changes in a feature request before investing in an implementation.

## Small contributions

You do not need to understand every Electron service or Windows integration. Good starting points include:

- Correcting an inaccurate or unclear document
- Fixing a translation while preserving the same locale structure
- Writing reliable reproduction steps for a bug
- Adding coverage for an existing behavior
- Fixing a contained layout, keyboard, or screen-reader issue

The maintainer checklist contains evidence-based candidate tasks that may be published as `good first issue` or `help wanted` issues.

## Pull requests

Keep each pull request centered on one purpose. A useful pull request description explains what changed, why it is needed, and how it was verified.

- Avoid unrelated refactors, formatting passes, and dependency changes.
- Add or update tests when behavior changes and a practical automated check exists.
- Include before and after screenshots for visible interface changes.
- Update documentation when commands, requirements, behavior, or user-facing limits change.
- State any Windows version, hardware, or privilege assumptions used during testing.
- Preserve third-party license, copyright, source, and notice files.
- Do not commit logs containing personal data, secrets, signing material, generated installers, or local environment files.

Automated checks run `npm ci`, `npm test`, and `npm run build` on Windows. A passing CI run does not replace targeted testing of system-facing behavior.

## Tweak contributions

Bundled tweak definitions live in `resources/tweaks/configs/`. Each definition has a matching script directory under `resources/tweaks/scripts/<tweak_id>/`.

Use a nearby tweak with the same container and action type as the structural reference. At minimum:

- Provide a stable lowercase snake_case `id` and name the JSON file `<id>.json`.
- Keep the PowerShell filename and `execution.script` reference consistent.
- Describe the exact setting or action, not an expected performance outcome.
- Set administrator, restart, compatibility, risk, and status-detection metadata honestly.
- Document destructive, security-sensitive, or compatibility-sensitive effects in `warnings` and `technical_details`.
- Define `apply`, `detect`, and `restore` execution actions in the existing schema.
- Ensure every configured parameter is declared by the PowerShell script.
- Add English, German, and French descriptions in `description_i18n` when the neighboring schema supports them.
- Add a profile mapping only when the tweak genuinely belongs in that existing profile.

Apply and restore paths must be considered together. If an action cannot be reversed, say so in the metadata and do not simulate reversibility. Registry, service, boot, networking, security, driver, power, and process changes require a concrete technical explanation and focused tests where practical.

Run `npm test` after changing a tweak. The catalog tests check canonical IDs, duplicate entries, referenced scripts, and configured PowerShell parameters.

## Translations

The interface currently ships with:

- English: `locales/en.json`
- German: `locales/de.json`
- French: `locales/fr.json`

Keep the nested key structure aligned across all three files. Preserve interpolation placeholders, punctuation with functional meaning, and technical terminology. Do not translate identifiers, executable names, registry paths, or command-line values.

To test a translation change:

1. Run `npm run dev`.
2. Select the language in Settings.
3. Open the affected view and check normal, loading, empty, warning, and error states that use the changed text.
4. Run `npm test` and `npm run build`.

## Security

Do not open a public issue or pull request for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md) so the report can be assessed privately.
