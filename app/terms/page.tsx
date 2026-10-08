import { SUPPORT_EMAIL } from "../../lib/deployment";
import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Use - Dash",
  description: "The terms that apply when you use Dash and ask its agents to research or take action.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="October 8, 2026">
      <p>These Terms of Use govern your use of Dash, including its website, iPhone app, decision cards, connected services, Vault, agents, isolated browsers, and task results. By creating an account or using Dash, you agree to these Terms and the <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use the service.</p>

      <h2>Eligibility and your account</h2>
      <p>You must be at least 13 years old to use Dash. If you have not reached the age of majority where you live, a parent or legal guardian must agree to these Terms for you. If you use Dash for an organization, you confirm that you have authority to bind that organization.</p>
      <p>You are responsible for providing accurate account information, protecting access to your devices and sign-in methods, and promptly reporting suspected unauthorized use. You are responsible for activity performed through your account when you requested, approved, or reasonably enabled that activity.</p>

      <h2>App license and ownership</h2>
      <p>Dash and its software, design, branding, and other service materials are owned by the developer or its licensors. They are protected by intellectual-property laws. The project source code is available under the MIT License. These service terms do not limit the rights granted by that license; bundled third-party materials retain their own terms.</p>
      <p>The iPhone app is licensed, not sold. Your license to the app is governed by Apple&apos;s <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" rel="noreferrer">Standard Licensed Application End User License Agreement</a>, including its permitted scope of use, unless a different license is presented through the App Store. These Terms additionally govern your Dash account and the service made available through the app.</p>

      <h2>Your content</h2>
      <p>You retain ownership of prompts, files, images, links, messages, calendar information, instructions, and other content you submit or choose to connect. You confirm that you have the rights and permissions needed to provide that content and to ask Dash to process it.</p>
      <p>You give Dash a limited, non-exclusive license to host, copy, process, transmit, display, and create task results from your content only as needed to operate, secure, and improve the features you use. This license ends when the content is deleted, except for temporary backups, legal retention, or information already sent to a third party at your direction.</p>

      <h2>Connected services</h2>
      <p>You may connect services such as Google or allow access to Apple Calendar. When you connect a service, you authorize Dash to access and use the information and permissions shown during connection for the features and tasks you choose. You may disconnect supported services from Settings, and you can change Apple permissions in iPhone Settings.</p>
      <p>Connected services and external websites are operated by third parties and remain subject to their own terms, privacy policies, availability, and account rules. Dash does not control those services and is not responsible for their content, security, decisions, or outages.</p>

      <h2>Agent tasks and external actions</h2>
      <p>Dash can research, prepare work, use connected sources, and, when you request or approve it, take actions on external services. Depending on the task, an action may send or modify a message, create or change a calendar event, submit a form, make or cancel a booking, begin a purchase, or make another external change.</p>
      <p>Your prompt, selected option, follow-up choice, and any confirmation you provide define the task you authorize. You must review the target, details, price, timing, recipients, and other important terms before approving a consequential action. An approval applies only to the action described at that point; Dash may ask again when important details change or additional authority is needed.</p>
      <p>External information can change between research and action. Availability, prices, policies, inventory, and confirmation details must be rechecked when the action is performed. Dash cannot guarantee that a third party will accept, complete, honour, reverse, refund, or cancel an action.</p>

      <h2>Isolated browsers and websites</h2>
      <p>Some tasks use a temporary isolated cloud browser to visit websites. If you explicitly import selected Chrome website sessions, only cookies for the domains you choose are transferred to the isolated browser profile. You are responsible for having permission to use each website and account. You must not direct an agent to bypass access controls, impersonate another person, or use an account you are not authorized to use.</p>

      <h2>Vault credentials and payment cards</h2>
      <p>Vault logins and payment cards are provided to help complete tasks you authorize. Full credentials and card details saved in the iPhone app remain in the iOS Keychain on your device; Dash stores limited metadata so an item can be identified. When needed, you must unlock the item with Face ID/password before it is encrypted for one-time use in the isolated browser. Your CVC (card security code) is requested only when needed for a transaction and is not saved to your Vault. Its encrypted release may be reused on the same website during the active task, as described in the Privacy Policy.</p>
      <p>You are responsible for the accuracy of Vault information, for having authority to use it, and for reviewing any transaction before approval. Unlocking a Vault item permits it to be filled for the current task; it does not expand the task beyond the action you selected or approved. Dash is not a bank, card issuer, merchant, marketplace, or payment processor. Purchases, deposits, refunds, cancellations, and disputes are between you and the applicable merchant or payment provider.</p>

      <h2>AI output and generated results</h2>
      <p>AI output, summaries, recommendations, extracted information, availability checks, and generated files may be incomplete, inaccurate, outdated, or unsuitable. You must review results before relying on them. Dash does not provide legal, medical, financial, tax, or other regulated professional advice, and its output is not a substitute for a qualified professional.</p>

      <h2>Acceptable use</h2>
      <p>You may not use Dash to violate law or another person&apos;s rights; harass, deceive, exploit, or harm people; gain unauthorized access; distribute malware; interfere with service operation; evade security, approval, or usage controls; scrape or overload systems without permission; or submit content or instructions you are not authorized to use. These restrictions concern misuse of a hosted service. They do not prohibit copying, modifying, reverse engineering, or redistributing source code when its license permits that activity.</p>

      <h2>Privacy, disconnection, and deletion</h2>
      <p>The <a href="/privacy">Privacy Policy</a> explains what information Dash handles and how it protects, retains, and deletes that information. Settings lets you remove supported integrations, remove Vault items, delete all account data, or delete your account. Deleting your account also requests deletion of the associated Dash data as described in the Privacy Policy.</p>
      <p>Deleting Dash data does not retract information already sent to another person or service at your direction, cancel an external booking or purchase, close a third-party account, or require a third party to erase records it independently keeps. You must manage those matters with the applicable third party.</p>

      <h2>Service availability and changes</h2>
      <p>Dash may add, change, suspend, or discontinue features, providers, limits, or integrations. The service may be interrupted by maintenance, provider failures, network conditions, or events outside the developer&apos;s control. There is no promise that any particular feature, model, website, integration, or task will always be available or produce the same result.</p>

      <h2>Suspension and termination</h2>
      <p>You may stop using Dash or delete your account at any time. The developer may restrict or suspend access when reasonably necessary to protect users or the service, comply with law, investigate abuse, or address a breach of these Terms. Where practical, notice and an opportunity to correct the issue will be provided.</p>
      <p>When hosted-service access ends, your right to use that hosted service ends. Rights granted under the MIT License to source code you received continue under that license. Provisions that by their nature should continue - including ownership, responsibility for completed external actions, disclaimers, liability limits, and dispute terms - will survive.</p>

      <h2>Disclaimers and limitation of liability</h2>
      <p>To the maximum extent permitted by law, Dash is provided “as is” and “as available,” without warranties that it will be uninterrupted, error-free, secure, accurate, or fit for a particular purpose. Nothing in these Terms excludes warranties or rights that cannot legally be excluded.</p>
      <p>To the maximum extent permitted by law, the Dash developer and its service providers will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, opportunities, goodwill, or data, arising from your use of the service. These limits do not apply where prohibited by law and do not limit liability that cannot legally be limited.</p>

      <h2>Governing law and disputes</h2>
      <p>Except where mandatory consumer law requires otherwise, these Terms and disputes relating to Dash are governed by the laws of Ontario and the federal laws of Canada applicable there, without regard to conflict-of-law rules. Before starting a formal claim, you and the developer agree to try to resolve the issue informally through the support contact below. Unresolved claims may be brought in the courts of Ontario, unless applicable law gives you the right to bring a claim elsewhere.</p>
      <p>Apple&apos;s Standard EULA separately governs the app license and contains its own governing-law provisions. Nothing in these Terms limits any non-waivable consumer right or remedy available where you live.</p>

      <h2>Changes to these Terms</h2>
      <p>These Terms may be updated when the product, providers, or legal requirements change. The date at the top will be updated, and additional notice will be provided before a material change takes effect when required. Continuing to use Dash after an updated version takes effect means you accept the revised Terms.</p>

      <h2>General terms</h2>
      <p>If a provision of these Terms is unenforceable, the remaining provisions continue in effect. A failure to enforce a provision is not a waiver. These Terms, the Privacy Policy, Apple&apos;s Standard EULA for the iPhone app, and any terms shown for a specific feature form the agreement governing your use of Dash. Third-party services remain governed by their own terms.</p>

      <h2>Contact</h2>
      <p>Dash is operated by its developer. For support, legal notices, or questions about these Terms, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Include the email address associated with your Dash account when the request concerns your account.</p>
    </LegalPage>
  );
}
