import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {openai} from '@ai-sdk/openai';
import {generateText} from 'ai';
import {personalChatVoiceGuidance} from '../lib/conversation-copy';
const before=execFileSync('git',['show','e7bd172:lib/conversation-copy.ts'],{encoding:'utf8'}).match(/personalChatVoiceGuidance = `([\s\S]*?)`;/)![1];
const cases=[
 {id:'invoice_answer',prompt:'The user asked what their recent IconScout invoices are for. Verified facts: three monthly API subscription invoices, $499 each, $1,497 total outstanding. Answer them briefly using only these facts.'},
 {id:'follow_up',prompt:'Conversation: user: why am i still getting bills if i cancelled? Verified context: cancellation stops future renewal but does not erase invoices already issued. Explain that directly without claiming any account-specific facts.'},
 {id:'thanks',prompt:'You just gave the requested invoice breakdown. User: ahh got it thx. Reply naturally; no task remains.'},
 {id:'correction',prompt:'You said the total was $1,479. User: u added it wrong its 1497. The user is correct. Respond.'},
 {id:'proactive',prompt:'Send a proactive text based only on these facts: user has a dentist appointment tomorrow at 9 AM, conflicting with their 9 AM team meeting. Ask which one they want to move. No changes have been made.'},
 {id:'email_draft',prompt:'User: write a short email to IconScout asking them to clarify what invoice INV-104 for $499 covers. Show the draft, with a subject and body. Do not send it. Use Michael as the sender name.'},
];
const results=[];
for(const sample of cases){
 const outputs=await Promise.all([before,personalChatVoiceGuidance].map(async system=>{
  const result=await generateText({model:openai('gpt-5.6-sol'),system,prompt:sample.prompt,maxOutputTokens:500,maxRetries:0,abortSignal:AbortSignal.timeout(45000),providerOptions:{openai:{reasoningEffort:'low',store:false}}});
  return result.text;
 }));
 const row={case:sample.id,before:outputs[0],after:outputs[1]};results.push(row);console.log(JSON.stringify(row));
}
writeFileSync('/tmp/dash-chat-voice-comparison.json',JSON.stringify({model:'gpt-5.6-sol',reasoningEffort:'low',results},null,2));
