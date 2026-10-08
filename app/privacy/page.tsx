import { SUPPORT_EMAIL } from "../../lib/deployment";
import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy - Dash",
  description: "How Dash collects, uses, protects, and deletes your information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 8, 2026">
      <p>Dash is a personal assistant that uses information you submit or choose to connect to identify things that need attention, research requests, and complete tasks you authorize. This policy explains what information Dash handles, why it is used, where it may be processed, and how you can control or delete it.</p>

      <h2>Information Dash handles</h2>
      <p>Account information includes your name, email address, sign-in provider identifier, session information, and account preferences. Connected-source information may include relevant Gmail or iCloud Mail messages, Google Calendar events, and Apple Calendar events supplied during a scan, including people, dates, locations, links, and message or event content.</p>
      <p>Dash also handles information you provide directly, such as prompts, answers, voice input sent for transcription, shared text, links, images, documents, and other files. Your workspace stores decision cards, selected options, running and completed tasks, task steps, generated results and files, learned preferences, and context you choose to add about your goals or routines.</p>
      <p>Limited device and service information is used to operate the product, including push-notification tokens, source connection status, scan state, timestamps, browser-task state, and operational error records. This source distribution does not include product-usage analytics or a built-in administrator interface for reading user conversations.</p>

      <h2>Connected Google services</h2>
      <p>If you connect Google, Dash requests the profile, Gmail, and Google Calendar permissions shown on Google’s consent screen. It uses them to find relevant decisions and, when a task you choose requires it, to read, organize, send, or update Gmail content and to read, create, update, or remove Calendar events. Google OAuth tokens are encrypted at rest.</p>
      <p>Hosting operators must configure their use and transfer of information received from Google APIs to comply with the <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noreferrer">Google API Services User Data Policy</a>, including its Limited Use requirements. Operators must not sell Google user data, use it for advertising, or send it to provider configurations that use it to train general-purpose AI models.</p>

      <p>Relevant Gmail message content and Calendar event details may be sent to our AI inference providers to identify suggestions, summarize information, and carry out your requested tasks. This processing supports the features you use; Google user data is not used to develop or train generalized AI models. You can stop future access by disconnecting Google and delete stored task and source data using the controls described below.</p>

      <h2>Connected iCloud Mail</h2>
      <p>Signing in with Apple does not give Dash access to your inbox. If you separately connect iCloud Mail, Dash stores your Apple app-specific password encrypted on its servers. It uses that connection to check recent inbox messages for helpful suggestions and to read messages for your requested tasks. Relevant message content may be sent to Dash’s AI service providers for this work. Your mail connection password is not sent to the AI model or saved in your chat.</p>
      <p>iCloud inbox checks leave messages unread. Email sends follow the approval flow, including any standing approval you have explicitly granted. Disconnecting iCloud Mail in Connected apps deletes Dash’s stored connection password and stops future checks; you can also revoke the app-specific password in your Apple account settings. Deleting your Dash data removes its iCloud Mail connection.</p>

      <h2>Optional Apple sources</h2>
      <p>In Settings, you can choose to connect Reminders, Contacts, Files, Photos, Health, Home, Music, Location, Maps, Weather, Alarms and Motion on your iPhone. Dash uses only sources you enable and the access iOS permits. When you use a connected source for a conversation, relevant data and the result of the requested action are sent to Dash and its AI service providers to answer your request. Files access is limited to the folder you select. Location is requested while the app is open. When a travel feature requests it, your iPhone can send travel times in minutes for upcoming events. The retired location-moment endpoint no longer stores arrival or departure events. Other location details are processed only when you use an enabled feature that supplies them.</p>
      <p>Health data is used only for your health and fitness requests. When you connect Health, you allow permitted Health results to be shared with Dash and its AI providers for those requests. You choose the Health data types iOS permits, and can change those permissions in Health or iPhone Settings. Dash does not use Health data for advertising, sell it, or use it for unrelated tasks. Requested Health reads and supported changes, such as logging water intake, run without a separate action confirmation once connected.</p>
      <p>Connections are saved separately for each account on each iPhone. Disconnecting stops future access through Dash; it does not revoke the iOS permission, remove information already shared in your conversations, or delete reminders, contacts, files, photos, playlists or alarms you created. Deleting your Dash data clears its connection settings on this iPhone and saved conversation data. You can manage system access in iPhone Settings.</p>
      <h2>Apple Calendar and shared content</h2>
      <p>Apple Calendar permission is controlled by iOS. When you choose to scan it, upcoming event data is sent to Dash so it can identify conflicts and decisions. You can turn access off in iPhone Settings.</p>
      <p>Content sent through the iOS share sheet is stored with your account so Dash can analyze it and create a task or decision. If you explicitly import selected website sessions from Chrome, only cookies for the domains you choose are transferred to your isolated cloud browser profile. Passwords, bookmarks, browsing history, and unrelated websites are not imported.</p>

      <h2>Decision cards</h2>
      <p>A decision card is Dash’s summary of something that may need your attention. Decision cards can contain source context, possible actions, recommendations, and the option you select. Decision cards are unrelated to payment cards, which are handled separately through the Vault.</p>

      <h2>Optional app connectors</h2>
      <p>If you connect an app through More connectors in Settings, Composio handles that app’s authentication and stores its connection credentials. Dash sends Composio an account identifier, requested tool inputs, and the information needed to carry out your task. Relevant results may be included in your conversation and processed by Dash’s AI providers. You choose which apps to connect and can disconnect them in Settings. Disconnecting stops future access through Dash; previously shared conversation data remains until you delete it. Clearing your Dash data also removes these connections.</p>

      <h2>Vault, passwords, and payment cards</h2>
      <p>Full usernames, passwords, card numbers, expiry dates, and billing postal codes saved through the Vault are stored in the iOS Keychain on your device and protected by device authentication. Dash’s server stores only the metadata needed to identify a saved item, such as its label, a login’s website and username hint, card brand, and last four digits. Saved cards can be chosen for any checkout. It does not store the full password or card number.</p>
      <p>When a task needs a saved item, you must unlock it using Face ID/password. The secret is encrypted to a one-time recipient and filled directly into the isolated HTTPS browser. It is redacted from AI model context, task logs, screenshots, and generated artifacts. Your CVC (card security code) is requested only when needed for a transaction. It is not saved to your Vault. An encrypted release may remain available for secure filling on the same website during the active task, including retries and reloads, and is cleared when the task ends or the release expires.</p>

      <h2>How information is used</h2>
      <p>Dash uses information to authenticate you, operate connected sources, find relevant decisions, research and complete tasks you deliberately start, remember preferences and context you provide or confirm, save your feed and task history, deliver notifications you enable, prevent abuse, troubleshoot failures, and improve reliability and safety.</p>
      <p>Dash does not sell or rent personal information, create advertising profiles, or track you across other companies’ apps or websites for advertising.</p>

      <h2>Service providers and other recipients</h2>
      <p>Information may be processed by providers needed to operate a feature you use. The AI providers selected by the hosting operator, including OpenAI, Anthropic, Meta, or Google, may process prompts and relevant task context for AI inference. Vercel, the configured database host, Inngest, and Apple Push Notification service support hosting, storage, background work and notifications. Exa may process research queries. Browserless provides cloud browser sessions, E2B provides isolated code environments, and Resia processes call instructions and call content when you request a phone call.</p>
      <p>Google, Apple, and websites an agent visits may receive information necessary for a sign-in, message, booking, form, purchase, or other action you requested. Providers receive only the information reasonably needed for their role. Information may also be disclosed when required by law, valid legal process, or the need to protect users, the public, or the service.</p>

      <h2>Hosting and access</h2>
      <p>Conversations and task history are stored on the server so the service can operate. They are not end-to-end encrypted from the hosting operator. A person with direct access to the database, server, backups, or provider accounts may be able to access that information even though the application has no administrator conversation viewer. Each operator must describe their own access controls, providers and retention practices.</p>

      <h2>Retention</h2>
      <p>Account details, connected-source state, decision cards, task history, preferences, and submitted content are retained while your account is active so your workspace continues across sessions. Short-lived authentication handoffs and one-time secret payloads expire or are deleted after their purpose is complete. Isolated task environments and provider logs follow their configured lifecycle.</p>

      <h2>Disconnecting sources</h2>
      <p>You can remove Google from Settings under Connected sources. This stops Gmail and Calendar watches, deletes Dash’s stored OAuth tokens, and asks Google to revoke access. Apple Calendar access can be changed in iPhone Settings.</p>

      <h2>Deleting your data or account</h2>
      <p>You can always delete your information from Settings under Account &amp; data. Delete all data disconnects sources and permanently deletes your workspace, history, agent runs, files, learned preferences, notifications, and saved Vault metadata while keeping your account available.</p>
      <p>Delete account deletes the same information, deletes your Dash account, and signs you out. When deletion is started from the iPhone app, Dash also deletes Vault entries from that device’s Keychain. Because Keychain items are stored locally, remove Vault items on any other device where you saved them. Local account data is deleted independently of provider availability. If a provider is unavailable, an encrypted cleanup record retains only the credentials and identifiers needed to finish disconnection; it is removed after cleanup succeeds. Sign-in is temporarily blocked while that cleanup is pending. Operators must run the documented cleanup worker and resolve persistent provider failures. Other information is retained only when required for legal, fraud-prevention, security, or backup-integrity purposes, and only for as long as that reason applies.</p>

      <h2>Security</h2>
      <p>Dash uses encrypted network connections, encrypted Google tokens, restricted service credentials, device-protected Keychain storage, isolated task environments, secret redaction, and confirmation boundaries for consequential actions. No internet service can guarantee absolute security.</p>

      <h2>Your choices and requests</h2>
      <p>You may edit your saved context and preferences, disconnect sources, remove individual Vault items, delete all data, or delete your account from Settings. You may also request access to or correction of your information through the developer support contact shown in the App Store listing or on the Google authorization screen.</p>

      <h2>Children, international processing, and policy changes</h2>
      <p>Dash is not directed to children under 13 and does not knowingly collect personal information from children under 13. Information may be processed in Canada, the United States, and other countries where Dash’s providers operate. Privacy and government-access rules may differ between countries.</p>
      <p>This policy may be updated when the product, providers, or legal requirements change. The date at the top will be updated, and additional notice will be provided when a change materially affects how personal information is collected, used, or disclosed.</p>

      <h2>Contact</h2>
      <p>For privacy questions or requests, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>, the Dash developer support contact. Include the email address associated with your Dash account so the request can be verified.</p>
    </LegalPage>
  );
}
