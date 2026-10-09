import Link from 'next/link';
import { LegalPage } from '../legal-page';

export const metadata = { title: 'Masuk - Anakbuah' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <LegalPage title="Masuk ke Anakbuah" updated="9 Oktober 2026">
    {params.error && <p>Proses masuk belum selesai. Coba lagi dari aplikasi Anakbuah. Jika baru menghapus data, pembersihan layanan yang terhubung mungkin masih berlangsung.</p>}
    <p>Buka Anakbuah di iPhone dan pilih metode masuk. Percakapanmu akan terbuka di aplikasi setelah berhasil masuk.</p>
    <p><Link href="/">Kembali ke Anakbuah</Link></p>
  </LegalPage>;
}
