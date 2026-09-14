# TOMORO COFFEE — Expiry Monitor

Versi branded dari F&B Expiry Monitor.

Perubahan:
- Logo TOMORO COFFEE pada sidebar dan mobile header
- Tema utama orange TOMORO + hitam + putih
- Status operasional tetap hijau / kuning / merah agar mudah dibaca
- Favicon dan PWA theme color disesuaikan
- Cache service worker dinaikkan versinya agar style baru termuat

## Cara run
Di terminal pada folder project:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Lalu buka:

```text
http://127.0.0.1:8080
```

Jika sebelumnya pernah menjalankan versi lama:
1. Refresh paksa browser (Ctrl+Shift+R).
2. Jika style lama masih muncul, hapus cache/site data atau unregister service worker.
3. Buka kembali halaman.

## Alarm
Tekan `Aktifkan Alarm Suara` sekali setelah halaman dibuka.
Biarkan halaman tetap terbuka agar warning/expired alarm dapat berjalan.
