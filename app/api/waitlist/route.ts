import {createHash} from 'node:crypto';
import {sameOrigin} from '../../../lib/http-security';
import {enforceApiQuota} from '../../../lib/api-quota';
import {joinWaitlist,waitlistInputSchema} from '../../../lib/waitlist';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'This request is not allowed.'},{status:403});
 try{
  if(Number(request.headers.get('content-length')??0)>4096)return Response.json({error:'Request too large.'},{status:413});
  const body=await request.text();if(body.length>4096)return Response.json({error:'Request too large.'},{status:413});
  const parsed=waitlistInputSchema.safeParse(JSON.parse(body));if(!parsed.success)return Response.json({error:'Enter a valid email address.'},{status:400});
  const ip=request.headers.get('x-vercel-forwarded-for')??request.headers.get('x-forwarded-for')??'local';
  const limited=await enforceApiQuota(`waitlist:${createHash('sha256').update(ip.split(',')[0].trim()).digest('hex')}`,'waitlist');if(limited)return limited;
  await joinWaitlist(parsed.data.email);
  return Response.json({joined:true},{headers:{'cache-control':'no-store'}});
 }catch(error){if(error instanceof SyntaxError)return Response.json({error:'Enter a valid email address.'},{status:400});return Response.json({error:'Couldn’t join right now. Please try again.'},{status:503});}
}
