# Maintainer Checklist

This checklist covers GitHub settings and follow-up work that cannot be completed through normal repository files. Verify the current repository state before changing a setting.

## GitHub repository settings

### Description and website

- [ ] Keep the description factual and aligned with the current public build. Suggested text: `Open-source Windows system configuration utility with hardware monitoring, game-session tools, and backup/restore.`
- [ ] Set the website URL to `https://nova-tweaks.com`.
- [ ] Confirm that Issues and Releases remain enabled.

### Topics

The audit supports the following topics:

```text
windows
windows-10
windows-11
windows-tweaks
optimization
system-utilities
privacy
gaming
hardware-monitoring
electron
react
open-source
```

- [ ] Add only the topics that remain accurate for the current release.

## Discussions

- [ ] Consider enabling GitHub Discussions after deciding who will moderate and answer it.
- [ ] If enabled, start with `General`, `Ideas`, `Q&A`, and `Show and tell`.
- [ ] Link general questions from `SUPPORT.md` to Discussions after the feature is active.

Discussions can keep support questions out of the bug tracker, but it should not be enabled without a plan to review posts.

## Social preview

- [ ] Upload a high-resolution GitHub Social Preview image that uses the current Nova Tweaks identity and remains readable at small sizes.

The audited website includes product screenshots but no asset clearly designed for GitHub's social-preview crop. Do not use a narrow interface crop without checking the preview in GitHub settings.

## Repository metadata

- [ ] Confirm the default branch is `main`.
- [ ] Verify the description, website URL, and topics after each material product change.
- [ ] Confirm the bug and feature issue forms render correctly.
- [ ] Confirm the latest release is marked as a pre-release while the published artifact remains a preview.
- [ ] Check that the release installer and `checksums.txt` are both present.
- [ ] Review the Funding link after GitHub processes `.github/FUNDING.yml`.

## Security and review settings

- [ ] Enable Private Vulnerability Reporting if the maintainer can monitor and respond to private reports. Update `SECURITY.md` only after it is active.
- [ ] Enable Dependabot alerts and review each alert in the context of the packaged Electron application and bundled helpers.
- [ ] Keep the weekly Dependabot configuration grouped and avoid automatic major-version updates.
- [ ] Consider dependency review for pull requests if it is available for the repository and produces actionable results.
- [ ] Add a branch ruleset for `main` after confirming it does not block the release workflow. A sensible starting point is required pull requests, required `Validate Windows source`, and blocked force pushes.
- [ ] Decide whether the single maintainer needs an emergency bypass before requiring pull requests for every change.
- [ ] Enable secret scanning and push protection if available for the public repository.

These controls should be enabled deliberately. Required checks must use the exact current workflow and job names, and release automation should be tested after changing repository rules.

## Candidate contributor issues

The following tasks come from the repository audit. Publish only the ones the maintainer is prepared to review.

### Add an automated locale parity check

- **Files:** `locales/en.json`, `locales/de.json`, `locales/fr.json`, `src/i18n.js`, a new focused test under the existing Node test setup
- **Work:** Compare nested keys and interpolation placeholders across the three locale files, then report missing or extra entries with readable paths.
- **Contributor fit:** The behavior is self-contained, requires no Windows system changes, and has objective output.
- **Acceptance criteria:** The test fails for missing, extra, or structurally incompatible locale entries; passes for the current files; and runs through `npm test` without adding a large dependency.

### Add local Markdown link validation

- **Files:** root Markdown documents, `docs/`, `package.json` or a small script in `scripts/`, and optionally `.github/workflows/ci.yml`
- **Work:** Check relative Markdown links and image paths without crawling arbitrary external sites.
- **Contributor fit:** The scope is documentation tooling with deterministic repository-local inputs.
- **Acceptance criteria:** Broken relative paths produce a clear failure, anchors used by project documents are handled, generated and vendored directories are excluded, and the check is documented.

### Strengthen tweak metadata completeness tests

- **Files:** `electron/services/localTweaks/catalogIntegrity.test.js`, representative files under `resources/tweaks/configs/`
- **Work:** Add narrowly defined checks for user-facing fields that the interface relies on, such as non-empty descriptions, compatibility data, risk information, and consistent translated descriptions.
- **Contributor fit:** Existing tests and 145 real definitions provide clear examples and immediate feedback.
- **Acceptance criteria:** Each new rule is justified by current renderer use, failure messages identify the config file and field, all current definitions pass, and no metadata is invented to satisfy the test.

### Remove hardcoded fallback copy from the Apps panel

- **Files:** `src/components/AppsPanel.jsx`, `locales/en.json`, `locales/de.json`, `locales/fr.json`
- **Work:** Audit `defaultValue` strings in the Apps panel and move missing user-facing copy into the existing locale structure.
- **Contributor fit:** The task is limited to one view and can be verified by switching the three supported languages.
- **Acceptance criteria:** User-facing Apps panel strings resolve from locale keys, interpolation remains correct, the three locale files retain matching structure, and the panel is checked in each language.

### Add unit coverage for blocked startup-source conversion

- **Files:** `electron/services/apps/appsManager.js`, `electron/services/apps/appsManager.test.js`, and `src/components/AppsPanel.jsx` only if a UI correction is needed
- **Work:** Document and test the existing safety boundary that startup entries cannot be converted between startup sources until migration and rollback rules exist.
- **Contributor fit:** The expected behavior already exists and the task adds protection against accidental exposure of an unsupported operation.
- **Acceptance criteria:** Tests cover invalid input, missing entries, unchanged types, and `APPS_STARTUP_TYPE_CHANGE_NOT_SUPPORTED`; the interface does not offer conversion when `canChangeType` is false; no startup source is modified by the test.

## Release review

- [ ] Update `CHANGELOG.md` from the actual tag and public release notes before publishing a new release.
- [ ] Confirm unsigned or signed status in the release notes and README.
- [ ] Run tests and builds from the tagged commit.
- [ ] Download the published artifacts and verify their SHA-256 values against `checksums.txt`.
- [ ] Test installation, launch, elevation, a reversible tweak, and uninstallation on a recoverable Windows system.
- [ ] Keep `SIGNPATH.md` factual until a future application and integration are approved.
