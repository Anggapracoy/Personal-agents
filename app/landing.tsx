import type { CSSProperties, ReactNode } from "react";
import { CHARACTERS, characterSvgMarkup } from "../lib/conversation-character";
import { Mascot, TaskIcon } from "./task-icon";
import LandingSmoothScroll from "./landing-smooth-scroll";
import styles from "./landing.module.css";
import glossy from "./glossy-button.module.css";

/* App Store launch CTA: preserved while access is invite-only.
const iosDownloadURL = process.env.NEXT_PUBLIC_IOS_DOWNLOAD_URL?.trim() || "/waitlist";

function DownloadLink({ small = false }: { small?: boolean }) {
  return <a className={`${styles.button} ${small ? styles.smallButton : ""}`} href={iosDownloadURL} target="_blank" rel="noreferrer"><span aria-hidden="true"></span><span><small>Download on the</small><strong>App Store</strong></span></a>;
}

*/

function WaitlistLink() {
  return <a className={`${styles.waitlistButton} ${glossy.button}`} href="/waitlist" aria-label="Join the waitlist"><Mascot className={styles.waitlistMark} size={44} eyeColor="#111"/><span className={styles.waitlistLabel}><small>Join the waitlist</small><strong>Early access</strong></span></a>;
}

function Character({ index }: { index: number }) {
  return <svg viewBox="0 0 44 44" aria-hidden="true" dangerouslySetInnerHTML={{ __html: characterSvgMarkup(index) }} />;
}

function Bubble({ children, outgoing = false, step = 0 }: { children: ReactNode; outgoing?: boolean; step?: number }) {
  return <div className={`${styles.bubble} ${outgoing ? styles.outgoing : ""}`} data-message-step={step}>{children}</div>;
}

function DemoChoices({question,options,step=0}:{question:string;options:string[];step?:number}) {
 return <div className={styles.demoChoices} data-message-step={step}><div className={styles.demoChoiceHeading}><span>{question}</span><span aria-hidden="true">×</span></div><div className={styles.demoChoiceRows}>{options.map((option,index)=><div key={option}><span>{String.fromCharCode(65+index)}</span><span>{option}</span></div>)}</div></div>;
}

function Composer() {
  return <div className={styles.composer}><span><svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" /></svg></span><div>Message Anakbuah...<span className={styles.composerMic}><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6" /></svg></span></div></div>;
}

function PhoneStatus() {
  return <div className={styles.phoneStatus}><b>9:41</b><i /><svg viewBox="0 0 67 16" fill="currentColor" aria-hidden="true"><rect x="1" y="10" width="3" height="4" rx=".7" /><rect x="6" y="7" width="3" height="7" rx=".7" /><rect x="11" y="4" width="3" height="10" rx=".7" /><rect x="16" y="1" width="3" height="13" rx=".7" /><path d="M24 5a12 12 0 0 1 16 0l-2 2a9 9 0 0 0-12 0Zm3.5 4a6.8 6.8 0 0 1 9 0L34.4 11a3.6 3.6 0 0 0-4.8 0ZM30 12.6a3 3 0 0 1 4 0L32 15Z" /><rect x="45" y="2" width="19" height="12" rx="3" fill="none" stroke="currentColor" strokeOpacity=".4" strokeWidth="1" /><rect x="47" y="4" width="15" height="8" rx="1.5" /><path d="M65.5 6v4a2 2 0 0 0 0-4Z" opacity=".4" /></svg></div>;
}

function HeroPhone() {
  const conversations = [
    { key: "preview:booking", title: "Booking L’Artusi", preview: "You’re booked for Sunday at 5 PM. I’ve added it to your calendar.", time: "now" },
    { key: "preview:Subscription cancelled", title: "Subscription cancelled", preview: "Your subscription is cancelled. You won’t be charged again.", time: "10:20" },
    { key: "preview:flight", title: "Check my flight", preview: "Website sign-in needed", time: "now" },
  ];
  return <div className={`${styles.deviceFrame} ${styles.heroPhone}`} role="img" aria-label="Anakbuah app preview with a waiting update, conversations and the Message Anakbuah composer">
    <div className={`${styles.phone} ${styles.homePhone}`} aria-hidden="true">
      <PhoneStatus />
      <div className={styles.homeToolbar}><span className={styles.homeProfile}><svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" fill="#dce4dc" /><path d="M5 40c0-10 6-15 15-15s15 5 15 15" fill="#52645d" /><path d="M16 23h8v7c-2 3-6 3-8 0Z" fill="#c98e6b" /><ellipse cx="20" cy="17" rx="8" ry="10" fill="#e4b18e" /><path d="M12 19c-3-10 1-15 8-15 8 0 11 7 8 15l-2-7c-4 1-7-1-9-3-1 4-3 5-5 5Z" fill="#40332c" /><path d="M17 21c2 2 4 2 6 0" fill="none" stroke="#a76d51" strokeWidth="1" strokeLinecap="round" /></svg></span><div className={styles.homeTools}><span><svg viewBox="0 0 24 24" fill="none"><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6" /></svg></span><span><svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></span></div></div>
      <div className={styles.homeConversations}>
        <div className={styles.homeSuggestion}><div className={styles.homeSuggestionAvatar}><TaskIcon conversationId="preview:subscription-renewal:0" size={54} /></div><div><strong>Your subscription renews tomorrow</strong><p>It’s $149. Want me to cancel before you’re charged?</p><div className={styles.homeSuggestionActions}><span>Cancel it</span><span>Keep it</span></div></div></div>
        {conversations.map(conversation => <div className={styles.homeRow} key={conversation.key}><TaskIcon conversationId={conversation.key} size={54} /><div><div className={styles.homeRowTop}><strong>{conversation.title}</strong><time>{conversation.time}</time><svg viewBox="0 0 7 12" fill="none"><path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div><p>{conversation.preview}</p></div></div>)}
      </div>
      <Composer />
    </div>
  </div>;
}

function Phone({ scene }: { scene: number }) {
  const titles = ["Book dinner", "Cancel subscription", "Email the hotel"];
  const ids = ["preview:booking", "preview:subscription-renewal:0", "preview:flight"];
  return <div className={`${styles.deviceFrame} ${styles.storyDevice}`} aria-hidden="true"><div className={`${styles.phone} ${styles.homePhone} ${styles.chatPhone}`}>
    <PhoneStatus />
    <div className={styles.chatHeader}>
      <span className={styles.chatControl}><svg viewBox="0 0 24 24" fill="none"><path d="m14 6-6 6 6 6" /></svg></span>
      <div className={styles.chatIdentity}><TaskIcon conversationId={ids[scene]} size={55} /><strong>{titles[scene]}</strong></div>
      <span className={styles.chatControl}><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v4M8 21h8" /></svg></span>
    </div>
    <div className={styles.messages}>
      <span className={styles.chatDate}>Today 9:41 AM</span>
      {scene === 0 ? <>
        <Bubble outgoing>Book a table for two at L’Artusi on Sunday.</Bubble>
        <DemoChoices step={1} question="They have a table at 5 PM. Does that work?" options={["Yes, book it", "Find a later time"]} />
        <Bubble outgoing step={2}>Yes, book it.</Bubble>
        <Bubble step={3}>You’re booked for Sunday at 5 PM. I’ve added it to your calendar.</Bubble>
      </> : scene === 1 ? <>
        <Bubble>Your subscription renews for $149 tomorrow. Want me to cancel before you’re charged?</Bubble>
        <DemoChoices step={1} question="What would you like to do?" options={["Cancel it", "Keep it"]} />
        <Bubble outgoing step={2}>Cancel it</Bubble>
        <Bubble step={3}>Your subscription is cancelled. You won’t be charged again.</Bubble>
      </> : <>
        <Bubble outgoing>Email the hotel that we’ll arrive at 8 PM on Friday.</Bubble>
        <Bubble step={1}>I’ve drafted the email. Review it before I send it.</Bubble>
        <div className={styles.emailApproval} data-message-step={2}>
          <strong>Send this email?</strong><small>Nothing has been sent yet.</small>
          <div className={styles.emailDetails}><div><span>To</span><b>stay@example.com</b></div><div><span>Subject</span><b>Friday arrival time</b><em>Edit</em></div><p>Hi, we’ll arrive around 8 PM on Friday. Please keep our reservation. Thank you!</p></div>
          <div className={styles.approvalActions}><span>Send</span><span>Don’t</span></div>
        </div>
      </>}
    </div>
    <Composer />
  </div></div>;
}

const scenes = [
  { id: "notice", phoneScene: 1, eyebrow: "", title: <>Your assistant<br />notices, too.</>, copy: "Connect your inbox and calendar so Anakbuah can spot things like renewal dates and schedule clashes. It brings them to you and offers to help.", label: "Anakbuah notices" },
  { id: "ask", phoneScene: 0, eyebrow: "", title: <>Tell Anakbuah what<br />you need done.</>, copy: "Message Anakbuah to book a table, cancel a subscription, or send an email. Your assistant handles the steps and lets you know how it went.", label: "You ask" },
  { id: "approve", phoneScene: 2, eyebrow: "", title: <>Help when needed.<br />Updates when done.</>, copy: "Anakbuah keeps working while you get on with your day. If it needs a detail, sign-in, or approval, it asks you in the chat.", label: "You’re in control" },
];

const intro = "Anakbuah is your personal assistant. It notices what needs attention and helps get it done. You can message it in the app or WhatsApp anytime.";

export default function Landing() {
  return <main className={`dash-landing ${styles.page}`} data-dash-landing>
    <LandingSmoothScroll />
    <a className={styles.skipLink} href="#how-it-works">Skip to how it works</a>


    <section className={styles.hero} id="top" data-hero>
      <div className={styles.heroSticky}>
        <div className={styles.heroStage} data-hero-stage>
          <div className={styles.orbit} aria-hidden="true" data-orbit>
            {CHARACTERS.map((character, i) => <div className={styles.orbitCharacter} data-orbit-character key={character.name} style={{ "--orbit-x": Math.cos(([-45, 0, 45, 135, 180, 225][i] * Math.PI) / 180), "--orbit-y": Math.sin(([-45, 0, 45, 135, 180, 225][i] * Math.PI) / 180), "--tilt": `${(i % 3 - 1) * 8}deg` } as CSSProperties}><Character index={i} /></div>)}
          </div>
          <div className={styles.heroCopy} data-hero-copy><h1>Your assistant.<br />Less on your plate.</h1><p>Message Anakbuah in the app or WhatsApp. It handles the steps and spots things you might need help with, too.</p><WaitlistLink /></div>
          <HeroPhone />
        </div>
        <div className={styles.intro} data-intro><p>{intro.split(" ").map((word, i) => <span key={i} data-intro-word>{word} </span>)}</p></div>
      </div>
    </section>

    <section className={styles.story} id="how-it-works" data-story aria-label="How Anakbuah works">
      {scenes.map((scene, i) => <span className={styles.sceneAnchor} id={scene.id} key={scene.id} style={{ "--scene": i } as CSSProperties} />)}
      <div className={styles.storySticky}>
        {scenes.map((scene, i) => <article className={styles.scene} data-scene={i} key={scene.id}>
          <div className={styles.sceneCopy} data-scene-copy>{scene.eyebrow && <span className={styles.eyebrow}>{scene.eyebrow}</span>}<h2>{scene.title}</h2><p>{scene.copy}</p></div>
          <div className={styles.phoneStage} data-phone-stage><Phone scene={scene.phoneScene} /></div>
        </article>)}
      </div>
    </section>

    <footer className={styles.footer} data-reveal-group aria-labelledby="closing-title">
      <div className={styles.closing} data-closing>
        <div className={styles.closingCopy} data-reveal="0">
          <h2 id="closing-title">A little less to do.<br />A little more life.</h2>
          <div className={styles.closingAction}><p>Let Anakbuah take it from here.</p><WaitlistLink /></div>
        </div>
      </div>
      <nav className={styles.footerLegal} aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
      <div className={styles.wordmarkStage} data-reveal=".1" aria-hidden="true">
        <div className={styles.wordmark}>Anakbuah</div>
        <div className={styles.closingCharacters}>{[0, 2, 3].map((index, i) => <div key={CHARACTERS[index].name} data-reveal={.2 + i * .1} style={{ "--tilt": `${[-8, 6, -5][i]}deg` } as CSSProperties}><Character index={index} /></div>)}</div>
      </div>
    </footer>
  </main>;
}
