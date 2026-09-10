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

The repository and the
[unsigned 1.0.0 preview](https://github.com/NovaTweaksDev/Nova-Tweaks/releases/tag/preview-v1.0.0)
are public.

## Validation record

- Automated tests for 1.0.1: 238 passed, 0 failed, 1 optional signing test skipped because
  its local test keys were not configured.
- GitHub Actions source validation: dependency installation, tests, and renderer
  build passed for commit `1d4d0df`. The preview workflow built and published
  the installer from the tagged commit.
- Windows smoke test: installation and normal application launch of the corrected
  installer succeeded in an Oracle VirtualBox Windows guest with two virtual CPUs.
  Follow-up tests confirmed administrator access, applying and reverting an admin
  tweak, Advanced Sensors, disabling/re-enabling sensors, and app restart with
  the preference retained. These were local 1.0.0 test builds containing the
  fixes prepared for 1.0.1. Hardware-specific features and the full tweak catalog
  were not exhaustively tested. The GitHub-downloaded 1.0.1 test is pending.
- A missing Visual C++ runtime dependency found during the first VM test was
  removed from all Nova-owned C++ helpers before the successful repeat test.

## Outstanding before claiming signing readiness

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
- Test the GitHub-downloaded 1.0.1 installer and backup/restore on a separate
  Windows test system; record uninstallation of that exact build.

## Submission text (draft, not submitted)

We request SignPath Foundation code signing for Nova Tweaks, a GPL-3.0-only
Windows desktop utility. Public source, documentation, and unsigned preview
installers are available at https://github.com/NovaTweaksDev/Nova-Tweaks.
The application starts without elevation and uses a restricted administrator
broker for requested system changes. Hardware monitoring is optional.

Our intended signing scope is the Nova-owned application, native helpers, and
installer. Bundled upstream components retain their own licenses and signatures;
we exclude LibreHardwareMonitor and PresentMon executables from Nova signing.
Corresponding modified LHM source and dependency notices ship with the package.

The preview is built through GitHub Actions. SignPath integration is not yet
configured. Some Nova helper binaries are currently checked in and must be built
from source in the trusted signing pipeline before signed releases. We would
like guidance on the approved artifact configuration and onboarding requirements.

Before submission, the maintainer must confirm their contact email, signing
roles, GitHub MFA, and the evidence of project reputation. Do not represent
these as verified or claim approval before SignPath confirms it.

Creating a fresh repository does not establish the reputation required by
SignPath Foundation and does not guarantee acceptance. The Foundation also
requires an existing release, documented behavior, eligible open-source
components, and verifiable builds.

Official references: [Application](https://signpath.org/apply.html),
[conditions](https://signpath.org/terms.html),
[project configuration](https://docs.signpath.io/projects).
