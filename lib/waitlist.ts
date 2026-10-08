import postgres from 'postgres';
import {z} from 'zod';
export const waitlistInputSchema=z.object({email:z.string().trim().max(254).email().transform(value=>value.toLowerCase())});
let database:ReturnType<typeof postgres>|undefined;
function sql(){if(!process.env.DATABASE_URL)throw new Error('Waitlist storage is unavailable');return database??=postgres(process.env.DATABASE_URL,{prepare:false,max:2,idle_timeout:20});}
export async function joinWaitlist(email:string,database=sql()) {await database`insert into waitlist_entries(email) values (${email}) on conflict(email) do nothing`;}
export async function listWaitlist(){return sql()<{email:string;created_at:Date}[]>`select email,created_at from waitlist_entries order by created_at desc,email`;}
