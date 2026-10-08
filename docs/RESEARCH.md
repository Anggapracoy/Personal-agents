# Anakbuah — riset produk dan kelayakan kanal

Tanggal akses: 8 Oktober 2026. Metode: membaca halaman publik lewat HTTPS dengan verifikasi TLS aktif. Tidak ada signup, transaksi, login akun pribadi, atau pengujian aplikasi kompetitor. Pernyataan vendor di bawah adalah klaim situs, bukan kemampuan yang telah kami uji.

## Produk referensi

| Produk | Temuan dari sumber | Inspirasi yang dipakai | Batas kesimpulan |
| --- | --- | --- | --- |
| [Instinct](https://instinct.com) | Personal assistant yang memahami pekerjaan dan prioritas; bisa di-text/call; mengklaim memakai ponsel dan komputer seperti manusia. Contoh: dispute bill, hadiah, groceries, janji dokter, perjalanan | Mulai dari pekerjaan kehidupan nyata; antarmuka familiar; jawab dengan hasil | Tidak membuktikan kanal spesifik, harga, coverage Indonesia, atau mekanisme credential |
| [Pally](https://pally.com) | Text-first, memori, konektor, morning brief, automations, riset, booking/purchases/calls; memeriksa izin untuk aksi yang belum diminta/disetujui | Satu percakapan lintas konteks; next action dan approval; progressive account linking | Belum menguji konektor, transaksi, keamanan, maupun reliabilitas |
| [folk](https://www.folk.app) | Memposisikan diri sebagai AI CRM untuk sales; relationship context, enrichment, follow-up, pipeline, 30+ integrasi dan AI assistants | Catatan orang penting, last interaction, komitmen terbuka, draft follow-up | CRM tim bukan pengganti kanal messaging dan bukan bukti personal assistant native |
| [Ollie](https://ollie.ai/) | Domain dikonfirmasi pengguna; halaman utama, robots dan llms mengembalikan 403 | Belum mengambil kesimpulan fitur | Membutuhkan akses konten publik yang dapat dibaca |
| [Fo](https://wajo.ai/fo) | Domain dikonfirmasi pengguna; HTTP 302 menuju `login.wajo.ai` | Belum mengambil kesimpulan fitur | Konten membutuhkan akses yang belum tersedia; tidak melakukan login |
| Caddy | Nama diberikan pengguna, URL belum dikonfirmasi | Belum mengambil kesimpulan fitur | Jangan menebak identitas perusahaan |

### Pally: detail yang relevan

FAQ menyebut tidak perlu aplikasi untuk berkirim pesan dengan Pally. Namun akses ke **iMessages milik pengguna** dilakukan melalui Pally Mac app. Ini dua kemampuan berbeda: kanal untuk berbicara dengan assistant versus sumber data chat yang boleh dibaca assistant.

FAQ juga menyebut encrypted password vault dan password disimpan di secure page, bukan chat. Situs mengklaim bisa menerima OTP lewat email/messages atau meminta di chat. Desain kita tetap memakai sesi aman untuk input OTP; tidak menyalin seluruh perilaku kompetitor. Klaim enkripsi vendor tidak menggantikan audit keamanan produk kita.

Saat diakses, Pally menyebut gratis dengan batas penggunaan yang terisi kembali; Cloud Mac merupakan add-on berbayar. Situs menyatakan rencana pendapatan dari fee merchant, dan merchant tidak dapat membayar untuk memengaruhi rekomendasi. Ini klaim model bisnis vendor pada tanggal akses, bukan bukti unit economics atau alasan produk Indonesia harus gratis.

### Instinct: dokumen pengguna

[URL PRD](https://files.instinct.com/rmj00kkmvo1n-prd-asisten-ai-lewat-chat?via=im) awalnya gagal 403. URL tanpa query kemudian mengembalikan HTTP 200, tetapi hanya HTML shell “Instinct Files”, bukan isi dokumen. Script publik yang diperlukan masih gagal 403. Karena itu, tidak ada isi PRD Instinct yang dikutip atau dianggap sudah dibaca.

## Bukti platform dan implikasinya

| Sumber resmi | Fakta yang terbaca | Keputusan produk |
| --- | --- | --- |
| [Google overview](https://developers.google.com/business-communications/rcs-business-messaging) | Menyebut interaksi di Android dan iOS; rich media, verified branding, read receipts | Kandidat satu kanal lintas OS; belum membuktikan coverage Indonesia |
| [How it works](https://developers.google.com/business-communications/rcs-business-messaging/guides/get-started/how-it-works) | JSON REST dan webhook; enkripsi agent–Google dan Google–device; halaman bertanggal 31 Oktober 2025 menyebut agent memulai conversation | Tidak menjanjikan E2EE; verifikasi flow dengan dokumentasi terbaru |
| [Launch approval](https://developers.google.com/business-communications/rcs-business-messaging/guides/launch/launch-approval) | Halaman bertanggal 7 Oktober 2026 mencakup P2A user-initiated entry points, review Google/carrier, brand verification, opt-out, preview, kebijakan dan aset publik | Uji flow P2A dan proaktif terpisah; siapkan kelengkapan review sebelum produksi |
| [Capability checks](https://developers.google.com/business-communications/rcs-business-messaging/guides/build/capabilities) | 404 dapat berarti agent belum launch di jaringan; capabilities memengaruhi aksi yang didukung; pesan offline dapat mengantre hingga 31 hari | Jangan menganggap 404 sebagai perangkat gagal; reminder perlu TTL dan penanganan pesan basi |
| [Apple Messages for Business](https://register.apple.com/messages) | Chat dengan bisnis di Messages, scheduling, authentication, Apple Pay, dan messaging service provider | Jalur resmi bisnis untuk dievaluasi; bukan API inbox iMessage pribadi, bukan bukti eligibility lokal |
| [Meta Send Messages](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) | Akun profesional, inbound memulai conversation, webhook, standard window umumnya 24 jam, permissions, Advanced Access untuk akun pihak lain, tanpa group messaging | DM MVP lanjutan untuk akun profesional eligible; tidak menawarkan bot bebas untuk semua akun |

Catatan: halaman carriers yang dibaca adalah dokumentasi administrasi operator, **bukan daftar cakupan Indonesia**. Jangan mengubahnya menjadi klaim operator mana yang tersedia.

## Rekomendasi produk dari riset

1. Positioning: “asisten yang mengurus urusanmu lewat pesan” dengan hasil yang bisa dibuktikan. Kalender/reminder adalah titik awal; memori dan konteks relasi meningkatkan nilai jangka panjang.
2. Pisahkan chat channel, account connection, dan action executor. Kemampuan salah satu tidak menyiratkan kemampuan lainnya.
3. Gunakan progressive onboarding: satu tugas berguna dahulu; koneksi akun saat dibutuhkan. Web aman untuk OAuth/credential; percakapan tetap di aplikasi pesan.
4. Pusatkan MVP pada reminder + kalender, lalu email draft dan riset. Travel execution dan Instagram menunggu akses serta acceptance criteria spesifik.
5. Jangan memakai klaim “semua akun” atau “pasti bisa booking” sebelum connector diuji. Tampilkan katalog layanan yang didukung dan hasil yang jujur.
6. Jadikan operator/perangkat Indonesia dan user 55+ sebagai uji produk wajib. Klaim produk Amerika belum membuktikan demand, biaya, atau kelayakan Indonesia.

## Pekerjaan riset yang masih memerlukan akses eksternal

- Isi dokumen Instinct, konten Ollie, dan Fo yang berada di balik login.
- URL Caddy yang dimaksud pengguna.
- Akun partner/provider dan perangkat/SIM uji Indonesia untuk membuktikan RCS, delivery proaktif, biaya dan coverage.
- Eligibility Apple Messages for Business, kebutuhan MSP serta aturan automation/proaktif untuk use case ini.
- Akun profesional Instagram dan aplikasi Meta yang eligible untuk sandbox/app review.
- Partner inventori/booking perjalanan, biaya transaksi dan aturan penggunaan.

Tidak ada blocker di atas yang disamarkan sebagai pengujian berhasil. PRD dan backlog bisa dilanjutkan; peluncuran integrasi nyata menunggu bukti akses dan hasil uji.
