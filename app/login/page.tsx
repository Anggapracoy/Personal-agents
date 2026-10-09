import Link from 'next/link';
import { LegalPage } from '../legal-page';
import { googleAuthEnabled } from '../../auth';

export const metadata = { title: 'Masuk - Anakbuah' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <LegalPage title="Masuk ke Anakbuah" updated="9 Oktober 2026">
    {params.error && <p>Proses masuk belum selesai. Coba lagi dari aplikasi Anakbuah. Jika baru menghapus data, pembersihan layanan yang terhubung mungkin masih berlangsung.</p>}
    <p>Masuk untuk membuka workspace Anakbuah di browser atau iPhone.</p>
    {googleAuthEnabled ? <p><a href="/api/auth/signin/google?callbackUrl=%2F">Masuk dengan Google</a></p> : <p>Login Google belum dikonfigurasi di environment ini.</p>}
    <p><Link href="/">Kembali ke Anakbuah</Link></p>
  </LegalPage>;
}
