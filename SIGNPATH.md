# SignPath application preparation

Status: application preparation; no SignPath approval or integration is claimed.

## Application draft

- Project: Nova Tweaks
- Maintainer: Elia / [NovaTweaksDev](https://github.com/NovaTweaksDev)
- Repository: https://github.com/NovaTweaksDev/Nova-Tweaks
- Download page: https://github.com/NovaTweaksDev/Nova-Tweaks/releases
- Website: https://nova-tweaks.com
- License: GPL-3.0-only; separately bundled components retain their own licenses.
- Description: Nova Tweaks is an open-source Windows desktop utility built with
  Electron and React. It provides Windows configuration tweaks, hardware
  monitoring, game-related controls, and backup/restore functionality. It starts
  without elevation and requests administrator access for operations that need it.
- Signing roles and privacy information: [README](README.md#code-signing-policy).

The repository is public. Verify the download link after publishing the first
preview release.

## Validation record

- Automated tests: 232 passed, 0 failed, 1 optional signing test skipped because
  its local test keys were not configured.
- GitHub Actions source validation: dependency installation, tests, and renderer
  build passed for commit `1412013`.
- Windows smoke test: installation and normal application launch of the corrected
  installer succeeded in an Oracle VirtualBox Windows guest with two virtual CPUs.
  Startup was slower under the constrained VM conditions. Hardware-specific
  features and the complete system-tweak flow were not covered by this smoke test.
- A missing Visual C++ runtime dependency found during the first VM test was
  removed from all Nova-owned C++ helpers before the successful repeat test.

## Outstanding before claiming signing readiness

- Publish the corrected, reviewed source and an accurately labeled Windows
  installer. The preview workflow produces an unsigned **local test build**;
  it must not be represented as a signed production release.
- Obtain SignPath approval and the actual organization, project, signing-policy,
  and artifact-configuration identifiers. The current release workflow uses
  `CSC_LINK` and `CSC_KEY_PASSWORD`; it does not submit artifacts to SignPath.
- Build Nova-owned helpers from source in the trusted CI pipeline. The current
  application build compiles the admin broker but packages checked-in builds of
  the game detector, NVIDIA helpers, and PresentMon helper. Their existing digest
  checks must stay effective when introducing CI builds and signing.
- Configure signing to cover only the approved Nova-owned artifacts, preserve
  third-party signatures, and enforce the required product name/version metadata.
  Verify the native helper metadata as part of that integration.
- Preserve the distinction between Windows Authenticode signing and the app's
  Ed25519 artifact/tweak/update trust configuration. Production packaging requires
  the intended public keys; SignPath does not replace those keys.
- Confirm maintainer MFA for GitHub and SignPath, configure manual signing
  approval, and publish the signing-policy link on the website/download page.
- Test an explicit elevated operation, backup/restore, and uninstallation on a
  separate Windows test system.

Creating a fresh repository does not establish the reputation required by
SignPath Foundation and does not guarantee acceptance. The Foundation also
requires an existing release, documented behavior, eligible open-source
components, and verifiable builds.

Official references: [Application](https://signpath.org/apply.html),
[conditions](https://signpath.org/terms.html),
[project configuration](https://docs.signpath.io/projects).
