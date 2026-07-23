# Ego Capture Bridge (Deprecated)

This package is a legacy prototype and is not part of PurpleInk's target production architecture. Do not use it for DiscoveryRun, CaptureRun, Golden E2E, deployment, or browser fallback.

This package must not import the Next.js application, persist browser credentials in the cloud, or implement video compilation.

All browser automation must run through the Linux Playwright Capture Worker defined by Engineering Contracts section 4, with one isolated container and BrowserContext per attempt. The target worker is not yet implemented in this package.

## Legacy behavior

- `MacKeychainIdentityStore` creates an Ed25519 device key and stores the private key in macOS Keychain.
- `BridgeApiClient` pairs the device, exchanges signed proofs for five-minute access tokens, and signs every session request.
- `CaptureRunner` executes fixed capture actions through `MockBrowserAdapter` or `EgoBrowserAdapter`.
- `EgoBrowserAdapter` creates one isolated Ego Task Space per session and closes it after completion.
- Navigation is HTTPS-only, exact-origin allowlisted, DNS checked, and blocks local, private, metadata, internal, and `file://` destinations.
- Evidence helpers reject Cookie, password, Token, localStorage, Profile, and authorization fields. DOM summaries never include form values or arbitrary attributes.
- Recovery checks a non-idempotent action's postcondition and enters `awaiting_user` when uncertain. It never repeats that action automatically.

These APIs and adapters remain only to describe current migration debt. They do not implement the accepted Playwright Capture Worker protocol and must not be presented as production capability.
