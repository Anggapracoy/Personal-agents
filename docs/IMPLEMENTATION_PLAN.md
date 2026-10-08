# Anakbuah — backlog implementasi MVP

Mengikuti [PRD](PRD.md) dan [hasil riset](RESEARCH.md). Status awal semua tiket: belum dikerjakan. Dokumen ini menyiapkan pekerjaan coding; tidak menyatakan backend atau integrasi sudah berjalan.

## Keputusan awal

- Target UX: percakapan aplikasi pesan bawaan, bahasa Indonesia, tanpa aplikasi tambahan di ponsel.
- Kanal MVP: WhatsApp Business Platform lintas Android dan iPhone; Apple Messages for Business dievaluasi terpisah. Tidak membuat relay iMessage personal tidak resmi sebagai default.
- Slice pertama: reminder persisten dan proposal kalender dengan approval. Tidak memulai dengan browser agent universal.
- Usulan stack: Node.js LTS + TypeScript; PostgreSQL; worker jobs persisten; web kecil untuk account connection; vault terkelola. Pin versi ketika scaffold dibuat.
- Produksi memerlukan provider terverifikasi. Adapter simulator boleh dipakai lokal, tetapi tidak dianggap bukti delivery native.

## Tiket dan kriteria selesai

| ID | Pekerjaan | Dependensi | Kriteria selesai |
| --- | --- | --- | --- |
| F01 | WhatsApp Business feasibility | Meta Business account, nomor uji, webhook | Catat verification, opt-in, template, inbound/outbound, delivery, window, biaya; pisahkan test mode vs production |
| F02 | Feasibility iPhone | F01 dan/atau MSP Apple | Pilih jalur yang didukung dengan bukti izin, onboarding dan reminder proaktif; dokumentasikan go/no-go |
| F03 | Consent dan entry point | Provider terpilih | Flow opt-in/opt-out dan trigger pertama disetujui; STOP menghentikan notifikasi |
| B01 | Scaffold backend dan penyimpanan | Tidak perlu kredensial produksi | Konfigurasi tervalidasi, migration, health check DB, local run guide; tidak ada secrets di source |
| B02 | Identitas dan adapter kanal | B01 | Webhook autentik, deduplication, binding tenant server-side; adapter simulasi dan contract test terpisah |
| B03 | Task orchestration | B01–B02 | Status tugas konsisten; model menghasilkan usulan terstruktur; validator/policy menolak tool call tidak sah |
| B04 | Approval engine | B03 | Approval terikat user, task, versi payload dan expiry; replay/approval user lain ditolak; audit tersedia |
| B05 | Jobs dan scheduler | B01–B03 | Restart-safe, deduplication, retry terkontrol, quiet hours, timezone IANA, cancellation, TTL pesan basi |
| C01 | Chat → reminder | B02–B05 | Tanggal ambigu ditanya; jadwal benar WIB/WITA/WIT; snooze/cancel bekerja; tidak ada duplicate side effect |
| C02 | OAuth Google | B01–B02 | State/PKCE sesuai flow, callback aman, token di vault, scopes minimal, revoke dan session expiry diuji |
| C03 | Kalender berizin | B04 dan C02 | Read conflict; preview timezone/duration; event dibuat sekali setelah approval; event ID diverifikasi |
| C04 | WhatsApp delivery end-to-end | F01–F03 dan C01 | Reminder diterima perangkat pilot; template/window, delivery failure dan duplicate webhook ditangani |
| M01 | Email triage + draft | C02 dan B04 | Ringkasan menunjuk pesan sumber; send terpisah dari draft; perubahan draft membatalkan approval |
| M02 | Riset bersumber | B03 | Jawaban dengan source/time; tidak mengarang live price; prompt injection dari web tidak mendapat izin eksekusi |
| M03 | Pengeluaran manual | B01–B03 | Rupiah/nominal ambigu dikonfirmasi; koreksi, daftar dan export terisolasi tenant |
| M04 | Memori dan kontrol | B01–B03 | Provenance, view/edit/delete/disable, akses antar-tenant ditolak; data sensitif tidak disimpulkan diam-diam |
| M05 | Portal akun dan privasi | C02 dan M04 | User dapat revoke, export, delete; secure links sekali pakai dan terikat user; secret tidak masuk analytics |
| Q01 | Keandalan dan keamanan | Semua slice terkait | Uji replay, cross-tenant, expiry, timeout, secret redaction dan injection lolos; incident recovery terdokumentasi |
| Q02 | Uji orang tua dan pilot | C04, M01–M05, Q01 | Ukur task success tanpa moderator, kebingungan approval, aktivasi, retensi dan biaya per tugas |

## Kontrak aksi minimum

Task proposal menyimpan `taskId`, `userId` server-side, `actionType`, payload tervalidasi, `payloadVersion`, sumber konteks dan status. Approval menyimpan hash/versi proposal, approver, expiry, cost ceiling jika relevan, dan waktu konsumsi. Executor menggunakan idempotency key per aksi; tidak menerima tenant atau approval status dari output model sebagai otoritas.

Untuk timeout aksi eksternal, tandai `outcome_unknown`, periksa provider dengan reference/idempotency key, baru putuskan retry. Pengguna menerima status yang sesuai. Sistem tidak boleh mengatakan “sudah dibooking” ketika hanya request yang terkirim.

## Paket validasi slice pertama

1. Bahasa: “besok jam 9”, “jam 8 malam”, “Jumat depan”, “tunda satu jam”; timezone tidak diasumsikan WIB.
2. Jobs: worker berhenti sebelum due time, restart setelah due time, webhook duplikat, cancel beradu dengan dispatch, offline delivery dan TTL.
3. Approval: expiry, double click, replay, user lain, perubahan jadwal/penerima, pending approval lebih dari satu.
4. OAuth: state mismatch, expired link, forwarded link, revoked token, scope kurang; nilai token tidak muncul pada model/log.
5. Kalender: konflik, provider error, response hilang setelah event tercipta, retry tidak membuat acara ganda.
6. Native channel: proof inbound/outbound/delivery per operator/perangkat; screenshot/log teredaksi dan timestamp hasil uji.

## Integrasi setelah pilot

Instagram: profesional eligible, inbound conversation, window enforcement pada saat send, scope/app review, dan human escalation. Travel: search aktual lebih dahulu; booking setelah API/partner dan rekonsiliasi pembayaran/reservasi terbukti. Credential login non-OAuth: per layanan, vault + isolated executor, tanpa password/OTP pada model/chat/log.

Milestone A dapat diselesaikan setelah akses provider tersedia. B01–B05 dan simulator bisa dikerjakan secara independen; simulator tidak menghilangkan gerbang C04 untuk klaim produk native.
