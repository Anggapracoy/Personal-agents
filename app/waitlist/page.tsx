import type {Metadata} from 'next';
import WaitlistForm from './waitlist-form';
export const metadata:Metadata={title:'Join the waitlist · Dash',description:'Request early access to Dash, your personal assistant.'};
export default function WaitlistPage(){return <WaitlistForm/>;}
