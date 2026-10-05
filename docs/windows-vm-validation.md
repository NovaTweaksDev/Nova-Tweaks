# Windows VM validation

Run only in a disposable Windows VM with a clean checkpoint. Never attach a VM runner to untrusted pull-request code with secrets or host access. Restore the checkpoint after every scenario. Record Windows build, package version, logs and the restore journal.

The regular Windows CI uses injected failure tests and an unsigned packaged smoke test. The smoke starts the actual entrypoint, verifies packaged resources and renders the dashboard in temporary user data; system-operation handlers, UAC and background workers are disabled. It does not establish that real tweaks work on a Windows build.

## Manual scenarios

1. **UAC cancellation:** launch the unsigned package as a standard user, choose a reversible registry tweak after inspecting its script, cancel UAC. Confirm no registry change occurred, the UI reports cancellation, and a later explicit request can retry.
2. **Safety backup failure:** make the VM's configured backup destination unwritable. Attempt an operation requiring a before-apply backup. Confirm the backup error and independently confirm the target registry/service state did not change. Restore permissions before continuing.
3. **Partial restore:** capture a complete Nova backup for four reversible stateful tweaks, change their states, and arrange a controlled failure on step three in a development VM fixture. Verify that the first two steps complete, the third fails, the fourth does not run, and the scope is not reported complete. Use service failure injection for this scenario; do not weaken production signature or integrity checks.
4. **Crash recovery:** terminate the VM app after a started step is durably journaled. Restart: no automatic continuation or UAC prompt is allowed. Explicitly continue and confirm live detection skips reached targets. An unavailable detection or changed backup/configuration must block continuation.
5. **Journal failure:** deny writes to the VM restore-journal directory. Confirm no next system change runs without a saved started entry. Keep the journal and inspect it after restoring permissions.
6. **Concurrency:** while restoring, attempt a UI tweak and trigger an automatic tweak rule. Both must be rejected with SYSTEM_OPERATION_BUSY. After termination or completion the execution gate must release.
7. **Settings:** restore language and theme, reopen the app, and confirm both persisted. Check progress, failure messages and the explicit continue button in English, German and French.
8. **Packaging:** run npm run test:packaged against the produced win-unpacked package. In a disposable copy, remove a required helper and repeat: the test must fail. Restore/delete the disposable copy afterward.

No VM runner is configured by this change. A future manually dispatched workflow must use a dedicated disposable Windows runner, reset its checkpoint even after test failure, and upload diagnostics before reset. Do not run real UAC, service, boot, networking or registry mutations on shared hosted runners.
