import Link from 'next/link';
import { LegalPage } from '../legal-page';

export const metadata = { title: 'Sign in - Dash' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <LegalPage title="Sign in to Dash" updated="October 8, 2026">
    {params.error && <p>Sign-in could not be completed. Try again in the iPhone app. If you just deleted your data, connected-service cleanup may still be finishing.</p>}
    <p>Open Dash on your iPhone and choose your sign-in provider. Your conversations open in the app after sign-in.</p>
    <p><Link href="/">Back to Dash</Link></p>
  </LegalPage>;
}
