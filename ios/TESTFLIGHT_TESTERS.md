# Adding TestFlight testers

This runbook covers the two TestFlight tester types in App Store Connect for your App Store Connect app.

## Internal testing

Use internal testing for teammates who should have App Store Connect access. Internal testers can test immediately after the build finishes processing; Beta App Review is not required.

1. In **Users and Access → People**, select **New User**.
2. Enter the person's name and Apple Account email address.
3. Select the **Developer** role, unless a different role is genuinely needed.
4. On the app-access page, select **your app** only. Do not grant access to unrelated apps.
5. Send the App Store Connect invitation. The person must accept it.
6. Open **Apps → your app → TestFlight → your internal group → Testers**.
7. Select **Add Testers**, choose the accepted user, and confirm **Add**.

The tester will receive access to all builds assigned to the internal group. If the person is not listed in the picker, confirm that they accepted the App Store Connect invitation and refresh the page.

## External testing

Use external testing for people who should not receive App Store Connect access.

1. In **Apps → your app → TestFlight**, create a group under **External Testing**.
2. Add the intended build to that group.
3. Complete the Test Information and Beta App Review fields if Apple requests them.
4. Invite testers by email or create a public invitation link.

External builds may require Beta App Review before testers can install them. Do not use the external flow solely to avoid adding a teammate as an internal tester when the team expects them to have App Store Connect access.

## Access hygiene

- Grant the lowest role and only the apps the person needs.
- Remove a person from both **Users and Access** and the relevant TestFlight group when their access ends.
- Delete unused external groups rather than leaving them available for future invitations.
