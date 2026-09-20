# Code signing status and SignPath preparation

## Current status

Nova Tweaks does not currently use a SignPath Foundation certificate.

A Foundation application submitted in September 2026 was not approved at that stage because the young project had not yet established sufficient externally verifiable public reputation and visibility. The response did not identify a technical or licensing defect. The project may reapply after building a broader public track record.

Current Windows releases remain unsigned unless a different documented signing method is configured. Windows can therefore display an `Unknown publisher` warning.

No SignPath organization, project, signing policy, or artifact configuration is active for Nova Tweaks. The repository must not be described as SignPath-approved or SignPath-signed.

## Public project record

- Repository: https://github.com/NovaTweaksDev/Nova-Tweaks
- Releases: https://github.com/NovaTweaksDev/Nova-Tweaks/releases
- Website: https://nova-tweaks.com
- License: GPL-3.0-only, with separately bundled components under their respective licenses
- Latest recorded preview: [1.0.1 unsigned preview](https://github.com/NovaTweaksDev/Nova-Tweaks/releases/tag/preview-v1.0.1)

Nova Tweaks is a Windows desktop utility built with Electron and React. It provides documented Windows configuration changes, local hardware monitoring, game-session tools, application and startup management, automation, and backup and restore functions. It starts without elevation and requests administrator access only for supported operations that require it.

## Validation record for preview 1.0.1

- The recorded automated test run completed with 238 passing tests, no failures, and one optional signing test skipped because local test keys were not configured.
- GitHub Actions dependency installation, tests, and renderer build passed for commit `d77f4e9`.
- The preview workflow built and published the installer from the tagged commit.
- The recorded source validation and preview workflow runs are [34501363861](https://github.com/NovaTweaksDev/Nova-Tweaks/actions/runs/34501363861) and [34501369307](https://github.com/NovaTweaksDev/Nova-Tweaks/actions/runs/34501369307).
- Local Windows virtual-machine testing covered installation, normal launch, administrator access, applying and reverting an administrator tweak, Advanced Sensors, disabling and re-enabling sensors, restart behavior, and retained sensor preference.
- The installer downloaded from the public 1.0.1 release was subsequently installed and launched, and administrator access was activated while the build was unsigned.
- Hardware-specific behavior and the complete tweak catalog were not exhaustively tested by the virtual-machine checks.

A missing Visual C++ runtime dependency found during initial virtual-machine testing was removed from Nova-owned C++ helpers before the successful repeat test.

## Existing technical preparation

- GitHub Actions validates source changes with `npm ci`, `npm test`, and `npm run build` on Windows.
- Preview tags build unsigned installers and publish the installer with `checksums.txt`.
- Release packaging distinguishes Windows Authenticode signing from the application's Ed25519 artifact, tweak, and update trust configuration.
- Third-party executables keep their upstream signature state and are excluded from Nova-owned executable signing configuration.
- LibreHardwareMonitor and PresentMon license, notice, origin, source, version, and digest records are maintained separately from Nova-owned code.
- Packaged tweak definitions, sidecars, and helper configuration have integrity and compliance checks in the test suite.

These controls support review and future signing work. They do not represent SignPath approval.

## Work required before a future signing integration

- Establish a broader, externally verifiable public project history before reapplying to the SignPath Foundation.
- Obtain the actual approved organization, project, signing-policy, and artifact-configuration identifiers before changing CI.
- Build all Nova-owned helpers from source in the trusted signing pipeline. The current application build compiles the administrator broker but packages checked-in builds of some other helpers.
- Keep existing digest checks effective when moving helper builds into CI.
- Limit signing to approved Nova-owned artifacts, preserve third-party signatures, and verify product name and version metadata.
- Keep Authenticode signing separate from the Ed25519 keys used for artifact, tweak, and update trust.
- Configure maintainer multi-factor authentication and manual signing approval as required by the signing service.
- Re-test backup, restore, installation, elevation, upgrade, and uninstallation using the exact signed artifacts produced by the future pipeline.

No SignPath integration should be added to the release workflows until approval and the required identifiers are available.

## Official references

- [SignPath Foundation application](https://signpath.org/apply.html)
- [SignPath Foundation conditions](https://signpath.org/terms.html)
- [SignPath project configuration](https://docs.signpath.io/projects)
