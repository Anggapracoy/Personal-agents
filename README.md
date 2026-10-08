# Anakbuah

Anakbuah adalah personal assistant melalui kanal pesan. Vertical slice saat ini menangani reminder dengan approval melalui WhatsApp webhook dan koneksi Google Calendar.

## Menjalankan lokal

Gunakan Node.js 20 atau lebih baru.

```bash
cp .env.example .env
npm test
npm start
```

Server berjalan di `http://localhost:3000`.

## Endpoint

- `GET /webhooks/whatsapp` — verifikasi webhook Meta.
- `POST /webhooks/whatsapp` — menerima pesan dan tombol approval.
- `GET /oauth/google/start?userId=...` — memulai OAuth Google Calendar.
- `GET /oauth/google/callback` — callback OAuth.

Untuk mengaktifkan integrasi nyata, isi credential melalui environment manager. Jangan commit `.env`, access token, client secret, atau file di `data/`.

## Status implementasi

Reminder, approval, persistence JSON, scheduler, WhatsApp payloads, Google OAuth PKCE, token encryption, calendar conflict checking, slot suggestions, dan calendar event creation sudah memiliki test. Pengiriman WhatsApp nyata dan Google OAuth produksi tetap membutuhkan akun provider, URL HTTPS publik, webhook configuration, serta review platform.

Persistence JSON hanya untuk development. Deployment produksi perlu PostgreSQL/managed database, secret manager, worker terpisah, rate limiting, dan observability.
