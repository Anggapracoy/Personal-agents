# PRD — Anakbuah: asisten pribadi AI lewat aplikasi pesan

Versi: 0.2 · 8 Oktober 2026 · Status: PRD dan backlog awal; integrasi produksi menunggu pembuktian kanal/provider.

## 1. Ringkasan produk

Asisten pribadi untuk pengguna Indonesia yang bisa diminta membantu lewat percakapan di aplikasi pesan yang sudah ada di ponsel. Pengguna tidak perlu memasang aplikasi baru, belajar prompt, atau memahami istilah agent. Asisten memahami bahasa Indonesia sehari-hari, mengingat preferensi yang diizinkan, dan membantu pekerjaan sampai hasilnya jelas.

Visi kanal: WhatsApp sebagai kanal MVP lintas Android dan iPhone, dengan pengalaman Messages/iMessage Apple sebagai jalur lanjutan yang dievaluasi terpisah. Dukungan setiap kanal harus melewati validasi teknis dan komersial.

Prinsip pengalaman: **tinggal bilang, lihat hasilnya, setujui ketika diperlukan**. Web hanya dipakai untuk penghubung akun, kredensial, pembayaran, dan pengaturan yang tidak cocok dilakukan lewat chat.

## 2. Status riset dan batas bukti

Riset lanjutan berhasil membaca situs Instinct, Pally, folk serta dokumentasi Google, Apple, dan Meta pada 8 Oktober 2026. Temuan situs produk adalah klaim vendor, bukan hasil pengujian aplikasi. Dokumen Instinct hanya menampilkan shell aplikasi tanpa isi PRD; asset yang diperlukan mengembalikan 403. Ollie masih mengembalikan 403; Fo mengalihkan ke halaman login. Benchmark dan keputusan terperinci ada di [RESEARCH.md](RESEARCH.md). Traction, reliabilitas aktual, dan cakupan Indonesia belum diverifikasi.

Referensi pengguna:

| Referensi | Sumber awal | Hal yang perlu diteliti | Status |
| --- | --- | --- | --- |
| Instinct | https://instinct.com dan [PRD yang dibagikan](https://files.instinct.com/rmj00kkmvo1n-prd-asisten-ai-lewat-chat?via=im) | Text/call tanpa antarmuka baru, tugas kehidupan sehari-hari, computer/phone use | Landing page dibaca; isi PRD belum terbaca |
| Pally | https://pally.com | Chat-first, memori, konektor, approval, vault di halaman aman | Situs dan FAQ dibaca; aplikasi belum diuji |
| folk | https://www.folk.app | Relationship context, follow-up, integrasi dan AI CRM | Situs dibaca; produk CRM, bukan bukti kanal personal assistant |
| Fo | https://wajo.ai/fo (dikonfirmasi pengguna) | Pengalaman pengguna, kanal, fitur, approval, dan harga | Belum diverifikasi |
| Caddy | URL belum dikonfirmasi | Identitas produk, delegasi tugas, approval, cakupan akun | Perlu URL |
| Ollie | https://ollie.ai/ (dikonfirmasi pengguna) | Kesederhanaan interaksi, rutinitas proaktif, integrasi dan harga | Belum diverifikasi |

Riset berikutnya harus membandingkan demonstrasi alur nyata: waktu onboarding, permintaan pertama, penghubung akun, output riset, approval, transaksi, kegagalan, memori, penghapusan data, dan model harga. Bedakan klaim pemasaran dari perilaku yang bisa diamati. Jangan menyimpulkan bahwa produk yang namanya sama adalah referensi yang dimaksud.

## 3. Masalah, segmen, dan hipotesis

Masalah utama: urusan kecil tersebar di kalender, email, chat, dan situs layanan; pengguna harus mengingat dan memindahkan konteks sendiri. Aplikasi AI terpisah menambah langkah dan sering berhenti pada jawaban, bukan penyelesaian.

Hipotesis pasar: pengalaman pesan bawaan, bahasa Indonesia natural, dukungan kebiasaan lokal, dan approval sederhana dapat menurunkan hambatan penggunaan. Peluang Indonesia dan keberadaan permintaan berbayar masih perlu dibuktikan; keduanya bukan hasil riset pasar pada versi ini.

Segmen pilot: pekerja dan pengelola keluarga yang rutin mengatur jadwal, email, serta perjalanan. Target kemudahan: orang tua yang terbiasa berkirim pesan dapat menyelesaikan permintaan tanpa pendamping setelah onboarding. Pengguna lanjut usia wajib ikut uji kegunaan, bukan hanya dijadikan ilustrasi pemasaran.

Job utama: “Saat urusan saya menumpuk, bantu saya mengingat, memilih, dan menyelesaikannya tanpa harus membuka banyak aplikasi.”

## 4. Tujuan dan ukuran keberhasilan

North star: jumlah tugas yang benar-benar selesai, dinilai membantu oleh pengguna, per pengguna aktif mingguan. Jawaban chat dan proposal yang belum dieksekusi tidak otomatis dihitung sebagai tugas selesai.

Target awal berikut adalah hipotesis pilot, bukan benchmark kompetitor:

| Ukuran | Definisi | Target awal |
| --- | --- | --- |
| Aktivasi | Tugas berguna pertama selesai dalam 24 jam setelah mulai onboarding | ≥60% pengguna pilot |
| Onboarding | Median waktu sampai tugas pertama, tanpa menghitung tunggu persetujuan provider | ≤5 menit |
| Usability | Peserta usia 55+ menyelesaikan reminder dan approval tanpa bantuan moderator | ≥80% pada sampel uji |
| Retensi | Pengguna aktivasi kembali menyelesaikan tugas pada minggu keempat | ≥40% |
| Keandalan reminder | Reminder diproses tepat pada waktu yang diminta; delivery dilaporkan terpisah | ≥99% |
| Eksekusi berizin | Aksi yang mensyaratkan approval memiliki approval sah untuk detail yang sama | 100% |
| Kepercayaan | Password/OTP tidak masuk ke chat, konteks model, atau log aplikasi | 0 kejadian yang diterima |

Untuk pesan eksternal, bedakan dikirim oleh sistem, diterima provider, terantar, dan dibaca. Ukur biaya model, biaya kanal, konektor, dan bantuan manusia per tugas selesai sebelum menetapkan harga.

## 5. Lingkup bertahap

### Fase 0 — Pembuktian sebelum membangun penuh

1. Buktikan WhatsApp Business Platform pada akun uji Indonesia: pengguna memulai chat, bot membalas, tombol approval bekerja, reminder dan template proaktif mengikuti aturan Meta.
2. Buktikan jalur resmi untuk pengalaman di Messages pada iPhone. Jangan menyamakan iMessage pribadi dengan Apple Messages for Business.
3. Hubungkan satu akun Google melalui OAuth dari tautan aman; uji read kalender dan penambahan acara setelah approval.
4. Jalankan satu reminder end-to-end sampai delivery teramati, termasuk saat proses worker restart.
5. Uji kelayakan Instagram messaging untuk jenis akun sasaran, izin aplikasi, review, dan batas percakapan.
6. Pilih jalur pencarian perjalanan yang memiliki data aktual dan ketentuan penggunaan yang sesuai. Jangan menjanjikan booking otomatis sebelum akses inventori dan transaksi terbukti.

Jika kanal wajib tidak tersedia, tulis keputusan go/no-go. Kanal lain hanya boleh menjadi fallback setelah keputusan produk eksplisit.

### Fase 1 — MVP yang berguna dan bisa dipercaya

MVP produk setelah kanal lolos fase 0:

- Chat bahasa Indonesia, follow-up singkat, konteks percakapan, dan lokasi waktu yang dikonfirmasi.
- Reminder, agenda harian, pemeriksaan bentrok, serta proposal membuat/mengubah acara kalender.
- Ringkasan email dan draft balasan untuk akun Google yang terhubung; pengiriman membutuhkan approval.
- Riset dan perbandingan dengan sumber, waktu pengecekan, serta batas ketidakpastian.
- Catatan pengeluaran manual dari chat dan laporan sederhana; bukan akses otomatis rekening bank.
- Memori preferensi yang dapat dilihat, dikoreksi, dilupakan, dan dimatikan.
- Halaman penghubung akun, pencabutan akses, riwayat aksi, pengaturan notifikasi, dan penghapusan data.

Urutan implementasi MVP: chat + reminder + kalender dahulu; email, pengeluaran, dan memori setelah fondasi approval dan jobs stabil. Riset menjadi jawaban berbasis sumber, bukan klaim akses semua situs.

### Fase 2 — Delegasi dan rutinitas

- Follow-up pekerjaan yang pengguna tandai: dokumen, janji, tagihan. Awalnya mengingatkan pengguna; menghubungi orang lain harus diotorisasi dengan penerima, pesan, dan jadwal yang jelas.
- Pantau harga, stok, dan deadline pada sumber yang didukung, dengan interval serta ambang notifikasi.
- Integrasi Instagram untuk akun dan tindakan yang benar-benar didukung API/provider.
- Hotel dan tiket: pencarian → pilihan → konfirmasi data penumpang → checkout/booking berizin → verifikasi hasil.
- Pengelolaan file pada storage terhubung, dengan preview perubahan dan pemulihan jika tersedia.

Tidak termasuk MVP: login universal ke semua situs, mengambil semua chat pribadi di ponsel, inbox iMessage pribadi, transaksi finansial tanpa batas, atau pembelian tanpa approval. Kebutuhan tersebut memerlukan dukungan platform dan desain tambahan.

## 6. Persyaratan fungsi

| Area | Perilaku yang wajib | Batas produk |
| --- | --- | --- |
| Waktu | Pahami “besok jam 8”, konfirmasi pagi/malam bila ambigu, cek konflik, usulkan alternatif | Jangan mengubah agenda diam-diam |
| Komunikasi | Ringkas email, jelaskan alasan prioritas, buat draft dengan penerima jelas | Chat lain hanya dari konektor yang didukung |
| Riset | Berikan rekomendasi singkat, alasan, sumber dan waktu pengecekan | Harga/stok bukan jaminan sampai dikonfirmasi penyedia |
| Follow-up | Simpan komitmen, due date, status dan siapa yang bertanggung jawab | Nagihan keluar memerlukan otorisasi |
| Admin | Catat nominal, mata uang, kategori; tanya jika ambigu; ekspor laporan | Catatan bukan rekonsiliasi bank atau pelaporan pajak resmi |
| Eksekusi | Preview detail, approval terikat aksi, jalankan sekali, laporkan bukti | “Sudah selesai” hanya setelah hasil diverifikasi |
| Pemantauan | Atur sumber, interval, ambang perubahan, dan berhenti berlangganan | Pengguna mengetahui biaya/frekuensi bila relevan |
| Memori | Simpan preferensi berguna dengan provenance dan kontrol pengguna | Jangan menyimpulkan data sensitif sebagai fakta |

## 7. Alur pengalaman utama

### Onboarding tanpa jargon

Pengguna membuka percakapan dari entry point yang disetujui provider. Asisten memperkenalkan fungsi dan meminta preferensi nama serta zona waktu dengan bahasa sederhana. Tawarkan contoh tugas: “Ingatkan saya minum obat jam 8 malam.” Jelaskan pengumpulan data secara ringkas dan tautkan informasi lengkap. Hubungkan akun hanya saat tugas membutuhkannya; fitur reminder tidak harus menunggu integrasi email.

### Reminder dan kalender

Pengguna: “Besok ingetin bayar listrik jam 9 pagi.” Asisten mengonfirmasi tanggal dan zona waktu dengan jelas. Pada waktunya, asisten mengirim reminder sesuai izin notifikasi. Pengguna dapat menjawab “tunda 1 jam”, “sudah”, atau “batalkan”. Perubahan tersimpan dan job lama tidak ikut terkirim.

Untuk permintaan meeting, asisten mengecek kalender, menunjukkan konflik dan durasi, lalu meminta approval sebelum menulis atau mengirim undangan. Konfirmasi memakai tanggal absolut selain kata “besok”.

### Riset dan booking perjalanan

Pengguna: “Cari tiket Jakarta–Bali Jumat depan, pulang Minggu, dua orang, total di bawah 4 juta.” Asisten melengkapi tanggal, bandara, bagasi, dan jam bila perlu; menyajikan maksimal tiga opsi yang relevan dengan waktu cek, biaya total yang diketahui, serta syarat perubahan/refund.

Pada fase pencarian, hasil akhirnya adalah opsi dan tautan checkout yang sesuai. Pada fase booking, approval harus mencakup rute, tanggal, identitas penumpang, jumlah, mata uang, bagasi, syarat, dan metode bayar. Jika harga berubah, minta approval baru. Booking dianggap berhasil setelah nomor reservasi dan status yang relevan diverifikasi; pembayaran berhasil saja belum cukup.

### Email dan Instagram

Pengguna: “Rangkum email penting hari ini dan siapkan balasan.” Asisten menunjukkan ringkasan, prioritas, draft, dan penerima. “Kirim” hanya berlaku pada draft tertentu yang masih valid. Perubahan isi/penerima membatalkan approval sebelumnya.

Instagram memakai alur yang sama hanya bila akun dan izin memenuhi ketentuan integrasi. “Akses Instagram” tidak berarti boleh membaca semua DM atau login ke akun personal apa pun.

## 8. Kredensial privat dan penghubung akun

Kebutuhan pengguna: username/password tidak pernah dikirim melalui jendela chat. Solusi utama adalah OAuth atau mekanisme delegasi resmi; aplikasi menerima token dengan izin minimum, bukan password akun.

Pengguna menerima tautan HTTPS sekali pakai menuju halaman penghubung akun, terikat identitas percakapan dan sesi dengan masa berlaku singkat. Identitas harus diverifikasi; siapa pun yang mendapat forward link tidak boleh otomatis mendapat akses akun. Sediakan halaman akun terhubung, izin, dan tombol putuskan koneksi.

Untuk layanan tanpa OAuth, dukungan hanya boleh ditambahkan per layanan setelah investigasi. Jika kredensial mentah diperlukan, gunakan vault khusus: enkripsi, pemisahan tenant, akses minimum, audit tanpa nilai rahasia, dan eksekutor yang mengambil kredensial tanpa memasukkannya ke prompt model. OTP/2FA dan CAPTCHA ditangani melalui sesi aman oleh pengguna; jangan simpan OTP atau bypass mekanisme keamanan.

Janji produk bukan “masukkan password apa pun lalu semuanya bisa diakses”. Janjinya: “hubungkan akun yang didukung melalui halaman privat, dengan izin yang jelas dan bisa dicabut.” Credential vault tidak otomatis mengatasi batas API, session expiry, ketentuan layanan, atau larangan otomasi.

## 9. Kanal dan gerbang kelayakan

Sumber resmi yang relevan: [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/), [Apple Messages for Business](https://register.apple.com/messages), dan [Instagram messaging](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api). Dokumentasi bukan bukti akun bisnis kita telah memperoleh akses atau berhasil dijalankan.

WhatsApp memberi jangkauan lintas Android dan iPhone, tetapi pesan proaktif, template, dan customer-service window tetap mengikuti kebijakan Meta. WhatsApp Business Platform bukan akses ke inbox WhatsApp personal pengguna dan tidak boleh diimplementasikan lewat WhatsApp Web automation.

Apple Messages for Business adalah jalur bisnis resmi yang berbeda dari inbox iMessage personal. Evaluasi eligibility, provider, entry point, dan aturan proactive messaging sebelum menjanjikan pengalaman iMessage native.

Instagram API yang dibaca ditujukan untuk akun profesional; percakapan dimulai oleh pengguna Instagram yang menghubungi akun tersebut. Jendela balasan umumnya 24 jam, dengan kondisi tertentu yang dijelaskan Meta; jangan memakai Human Agent window untuk memperpanjang bot otomatis. Memerlukan `instagram_business_basic` dan `instagram_business_manage_messages`, serta Advanced Access untuk akun profesional pihak lain. Tidak mendukung group messaging. Karena itu, fitur DM fase 2 dibatasi akun profesional eligible dan percakapan yang diizinkan.

| Kanal | Hipotesis jalur | Bukti yang harus didapat |
| --- | --- | --- |
| Android + iPhone / WhatsApp | WhatsApp Business Platform/Cloud API melalui jalur resmi Meta | Business verification, nomor bisnis, template, webhook, opt-in, window, delivery, biaya |
| iPhone / Messages | Apple Messages for Business melalui provider yang disetujui | Eligibility, provider, approval, entry point, batas reminder/proaktif, cakupan Indonesia |
| iMessage pribadi | Jangan diasumsikan tersedia sebagai API bot server | Jalur integrasi resmi yang sesuai; tanpa bukti, jangan masukkan sebagai komitmen rilis |
| Instagram DM | API/provider untuk akun yang eligible | Jenis akun, scope, app review, jendela balasan, webhook, batas memulai pesan, pencabutan akses |

Validasi kanal dilakukan sebelum investasi besar pada fitur. Bahkan bila chat responsif berjalan, dukungan reminder dan follow-up proaktif bisa berbeda; kedua alur harus diuji terpisah.

## 10. Arsitektur untuk implementasi bertahap

Komponen minimum: adapter kanal → autentikasi pengguna → orkestrator tugas → policy/approval → konektor atau job worker → verifikasi hasil → balasan. Kalender, email, pencarian, dan Instagram memakai konektor terpisah dengan kapabilitas eksplisit.

Stack awal yang diusulkan: satu backend TypeScript, PostgreSQL untuk user/task/approval/memory/audit, antrean jobs yang mendukung retry dan deduplication, serta web kecil untuk OAuth dan pengaturan. Pilih provider model dan kanal setelah bukti integrasi serta perhitungan biaya. Gunakan secret manager/vault terkelola; jangan membangun enkripsi sendiri.

Model hanya mengusulkan aksi terstruktur. Policy engine memutuskan izin; worker memanggil tool. Pesan/email/halaman web adalah data tidak tepercaya, bukan instruksi untuk mengubah izin atau mengambil rahasia. Tool hanya boleh menerima parameter yang telah divalidasi, dengan identitas tenant yang ditetapkan server.

Entitas inti: User, ChannelIdentity, AccountConnection, Task, TaskRun, Approval, Reminder, Memory, Expense, AuditEvent. Secret/token disimpan di vault; database aplikasi menyimpan referensi dan metadata yang diperlukan.

Status tugas: menerima → perlu informasi → direncanakan → menunggu approval → menjalankan → berhasil/gagal/hasil belum pasti/dibatalkan. Jangan memetakan timeout transaksi langsung ke gagal lalu mengulang pembayaran.

## 11. Approval, keandalan, dan privasi

- Approval harus memiliki ID, user, ringkasan aksi, versi detail, batas biaya bila ada, masa berlaku, dan status sekali pakai. “Ya” tanpa konteks tunggal tidak cukup.
- Read-only mengikuti izin konektor. Write, kirim pesan, berbagi file, booking, pembelian, dan penghapusan meminta approval yang sesuai. Izin rutin di masa depan harus memiliki scope, batas, dan cara mencabut.
- Webhook diverifikasi dan dideduplikasi. Jobs menggunakan idempotency; retry dibatasi dan tidak mengulang side effect tanpa pemeriksaan hasil.
- Pisahkan ACK cepat dari penyelesaian tugas. Untuk tugas panjang, beri status dan cara membatalkan. Jangan mengarang hasil saat konektor gagal.
- Konfirmasi WIB/WITA/WIT berdasarkan pengguna; jangan mengasumsikan semua pengguna Indonesia memakai WIB. Simpan waktu UTC dan zona IANA.
- Terapkan quiet hours, preferensi frekuensi, dan opt-out. Bahasa sederhana, pesan singkat, pilihan yang jelas; jangan mengharuskan command khusus.
- Pengguna dapat melihat dan menghapus memori, mencabut akun, mengekspor data, serta menghapus akun. Tentukan retensi percakapan, audit, backup dan batas pemulihan sebelum beta.
- Tinjau kewajiban UU PDP, transfer data lintas negara, kontrak penyedia, dan kebutuhan pendaftaran yang berlaku sebelum peluncuran. Ini pekerjaan validasi, bukan klaim kepatuhan.
- Untuk pilot, jangan gunakan data pengguna untuk pelatihan model tanpa pilihan dan dasar yang jelas. Informasikan provider pemrosesan yang dipakai.

## 12. Acceptance criteria

1. Pengguna di perangkat dan operator pilot menyelesaikan tugas melalui aplikasi pesan bawaan tanpa memasang aplikasi baru; channel callback terikat user yang benar.
2. Reminder “besok jam 9 pagi” menghasilkan waktu yang benar, tetap tersedia setelah worker restart, dan tidak terkirim dua kali ketika webhook diulang. Cancel sebelum dispatch mencegah kirim; jika sudah dispatch, UI menyatakan batas pembatalan.
3. Penulisan kalender memerlukan approval, membuat satu acara yang benar, dan melaporkan event ID/link yang dikembalikan provider. Bentrok menghasilkan pilihan, bukan perubahan otomatis.
4. Email penting dirangkum dari pesan yang benar dengan referensi; draft tidak terkirim sebelum approval. Pergantian penerima/isi meminta approval baru.
5. Dua tenant tidak bisa membaca memori, token, task, atau approval milik satu sama lain, termasuk melalui URL sesi penghubung akun.
6. Log, trace model, analytics dan chat tidak memuat password, OTP, token mentah, atau nilai secret. OAuth callback dan revoke diuji end-to-end.
7. Kegagalan/timeout provider ditampilkan dengan jujur. Transaksi berstatus belum pasti direkonsiliasi sebelum retry.
8. Untuk booking fase 2, approval harga lama tidak berlaku pada harga baru; hanya satu transaksi terjadi; status reservasi diverifikasi.
9. Instruksi berbahaya di email/web/DM tidak dapat memicu pengiriman, mengambil token, atau mengubah policy.
10. Memori dapat diperbaiki/dihapus; akses akun yang dicabut berhenti dipakai oleh jobs yang belum dieksekusi.

Pengujian memakai sandbox/provider test account sebelum data dan pembayaran nyata. Uji usability mencatat keberhasilan tanpa bantuan, salah paham approval, kebingungan tanggal, serta pengalaman pemulihan saat gagal.

## 13. Monetisasi dan distribusi — hipotesis

Mulai dengan pilot undangan untuk satu segmen; ukur kebiasaan dan willingness to pay setelah pengguna mendapatkan hasil nyata. Uji langganan dengan kuota tugas transparan; aktivitas berbiaya tinggi harus terlihat sebelum dieksekusi. Harga belum ditentukan karena biaya kanal, model, konektor, dan support belum diketahui.

Distribusi yang perlu diuji: rujukan keluarga, komunitas pekerja/pengelola keluarga, serta landing page yang memulai percakapan melalui entry point resmi. Jangan mengandalkan klaim “native” bila proses sebenarnya meminta pemasangan aplikasi tambahan atau relay tidak resmi.

## 14. Rencana pengerjaan vibe coding

Tidak menetapkan durasi sebelum feasibility kanal selesai. Setiap milestone memiliki demo dan gerbang keluar:

| Milestone | Hasil yang didemokan | Gerbang lanjut |
| --- | --- | --- |
| A. Riset & feasibility | Benchmark sumber terverifikasi, demo kanal Indonesia, matriks akun/izin, estimasi biaya | Ada jalur legal/teknis untuk chat dan reminder; keputusan eksplisit untuk iPhone |
| B. Fondasi | Identitas kanal, policy, approval, job persistence, audit, web akun | Isolasi tenant, replay/deduplication, secure-link dan secret handling lolos |
| C. Vertical slice | Chat → reminder dan OAuth kalender → proposal → approval → event nyata | Acceptance criteria 1–3, 5–7 dan 9–10 lolos untuk slice |
| D. MVP lengkap | Email draft, riset sumber, pengeluaran, memori terkontrol | Uji fungsi dan usability; biaya per tugas diketahui |
| E. Pilot | Penggunaan nyata terbatas, monitoring, support dan recovery | Aktivasi, retensi, kepercayaan, dan unit economics layak |
| F. Delegasi lanjut | Instagram eligible, pemantauan, pencarian/booking perjalanan | Review integrasi, transaksi sandbox, approval dan rekonsiliasi lolos |

Saat coding, pecah kerja per vertical slice dengan acceptance criteria, bukan meminta model membangun semua fitur sekaligus. Setiap integrasi punya mock untuk pengembangan dan contract test terhadap sandbox; mock bukan bukti integrasi produksi bekerja.

## 15. Keputusan yang belum selesai

1. URL persis Caddy serta akses referensi produk dan isi dokumen Instinct. URL Fo dan Ollie telah dikonfirmasi pengguna.
2. Provider WhatsApp Business dan kelayakan jalur Apple Messages for Business di Indonesia.
3. Ketersediaan reminder proaktif pada masing-masing kanal dan biaya per delivery/task.
4. Jenis akun Instagram sasaran: personal, creator, atau bisnis; capability yang diizinkan.
5. Sumber inventori penerbangan/hotel dan apakah checkout diserahkan ke pengguna atau dieksekusi lewat partner.
6. Kebijakan retensi, vendor pemrosesan data, dan desain kredensial untuk layanan tanpa OAuth.
7. Hasil wawancara pengguna Indonesia dan willingness to pay untuk memilih segmen serta harga.

Urutan keputusan berikutnya: selesaikan bukti kanal dan baca referensi → tetapkan MVP → implementasikan vertical slice reminder + kalender → perluas berdasarkan hasil pilot.
