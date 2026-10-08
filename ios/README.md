# Dash for iPhone

This project is a native SwiftUI shell around the hosted Dash workspace. Product UI and agent behavior continue to ship from the Next.js application; the shell owns secure authentication handoff, native navigation boundaries, downloads, sharing, haptics, and connection states.

## Run locally

1. Start the web app from the repository root with `pnpm dev`.
2. Open `DecisionFeed.xcodeproj`.
3. Select an iPhone simulator and run the `DecisionFeed` scheme using the Debug configuration.

Debug loads `http://localhost:3000`. Set your Release origin in `Config/Release.xcconfig` before distributing.

Google sign-in from the wrapper requires `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET`, plus migration `0004_mobile_auth_handoffs.sql`.

## Release

The Release configuration uses the non-resolving example origin `https://dash.example.invalid` and example bundle identifier `com.example.dash`. No Apple team is assigned. Before signing, follow [installation configuration](../docs/INSTALLATION_CONFIG.md) to set your origin, team, bundle identifiers and app group. Export options infer the team from your signed archive. The project includes its App Store icon, export-compliance declaration, and privacy manifest.

Before a device or TestFlight archive can be signed, Xcode must have a current Apple Development or Apple Distribution identity for that team. A free Personal Team can install development builds on registered devices but cannot publish through TestFlight; TestFlight requires an active Apple Developer Program membership.

Create a release archive from Xcode with **Product → Archive**, then distribute it through **App Store Connect → Upload**. Web-only releases continue to arrive through the hosted URL without a new native binary; native bridge or permission changes require a new iOS version.

For adding internal or external testers, see [TESTFLIGHT_TESTERS.md](./TESTFLIGHT_TESTERS.md).

## Compatibility contract

The shell calls `/api/mobile/config` before loading the workspace. Regular web releases remain compatible with wrapper version 1. Increase the minimum wrapper version only when a web release depends on a new native bridge or permission.

## Chat notifications

`DecisionFeedNotificationService` converts mutable APNs alerts into communication notifications using `INSendMessageIntent`. Its bundled avatars match `lib/conversation-character.ts`; payloads carry the stable conversation key and avatar index. The parent app requires the Communication Notifications entitlement; the service extension uses its own standard provisioning profile and must be embedded and signed during a device/TestFlight build. Validate an actual APNs delivery on a physical iPhone before release; simulator-injected notifications may bypass the service extension.
