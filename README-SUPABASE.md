# TOMORO COFFEE Expiry Monitor — Supabase Realtime

Versi ini mengganti penyimpanan produk dari `localStorage` menjadi **Supabase Auth + PostgreSQL + Realtime**.

## Fitur
- Login menggunakan ID atau email + password
- Data produk disimpan online
- Banyak perangkat dalam workspace/outlet yang sama melihat data yang sama
- Insert / update / delete tersinkron secara realtime
- Warning dan alarm expired berjalan pada semua perangkat yang sedang membuka aplikasi
- RLS membatasi data hanya untuk anggota workspace/outlet
- File versi lama disimpan sebagai `app.local-backup.js`

---

## A. Buat project Supabase

1. Buka https://supabase.com dan buat project baru.
2. Tunggu database selesai dibuat.
3. Buka **SQL Editor**.
4. Copy seluruh isi `supabase-setup.sql`.
5. Klik **Run**.

Script akan membuat:
- `workspaces`
- `workspace_members`
- `products`
- RLS policies
- Realtime publication untuk tabel `products`

---

## B. Ambil URL dan API key

Di dashboard Supabase, buka **Project Settings / API** atau **Connect** sesuai tampilan dashboard.

Cari:
- Project URL
- Publishable key / anon key

Buka `supabase-config.js`, lalu isi:

```js
window.SUPABASE_CONFIG = {
  url: "https://PROJECT_ID.supabase.co",
  anonKey: "PUBLISHABLE_OR_ANON_KEY"
};
```

PENTING:
- Publishable/anon key memang boleh digunakan di frontend jika RLS sudah benar.
- JANGAN masukkan `service_role` key ke website/browser.

---

## C. Buat akun login

Buka:
**Authentication > Users > Add user**

Contoh akun:
- Email: `outlet001@expiry.local`
- Password: password yang Anda tentukan

Karena form login mendukung ID sederhana, staff cukup mengetik:

```text
outlet001
```

Script otomatis mengubahnya menjadi:

```text
outlet001@expiry.local
```

Anda juga bisa memakai email normal.

---

## D. Buat workspace / outlet

Di SQL Editor:

```sql
insert into public.workspaces(name)
values ('TOMORO Bintaro')
returning id;
```

Copy UUID hasilnya.

Lalu buka **Authentication > Users**, copy UUID user yang sudah dibuat.

Hubungkan user ke workspace:

```sql
insert into public.workspace_members(workspace_id, user_id, role)
values (
  'UUID_WORKSPACE',
  'UUID_USER',
  'owner'
);
```

---

## E. Banyak user, data outlet tetap sama

Lebih aman membuat akun berbeda untuk tiap staff.

Misal:
- `dimas@...`
- `andi@...`
- `siska@...`

Semua masukkan ke `workspace_id` yang sama:

```sql
insert into public.workspace_members(workspace_id, user_id, role)
values
('UUID_WORKSPACE_SAMA', 'UUID_DIMAS', 'staff'),
('UUID_WORKSPACE_SAMA', 'UUID_ANDI', 'staff'),
('UUID_WORKSPACE_SAMA', 'UUID_SISKA', 'staff');
```

Ketiga akun otomatis melihat daftar produk yang sama.

Secara teknis Anda juga bisa login akun yang sama di beberapa HP, tetapi akun terpisah lebih aman untuk audit.

---

## F. Test lokal

Jalankan:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Buka:

```text
http://127.0.0.1:8080
```

Test:
1. Login di browser/HP A.
2. Login dengan user anggota workspace yang sama di browser/HP B.
3. Tambah produk di A.
4. Produk harus muncul di B tanpa refresh.
5. Set expiry beberapa menit ke depan.
6. Aktifkan audio pada masing-masing perangkat.
7. Saat warning/expired, alarm akan muncul pada masing-masing perangkat selama halaman aktif.

---

## G. Deploy online

Folder ini adalah static website. Bisa di-deploy ke:
- Vercel
- Netlify
- GitHub Pages
- Hosting HTTPS lainnya

Sesudah deploy, Supabase tetap menjadi database online bersama.

---

## H. Jika realtime tidak bekerja

Cek bahwa `products` masuk publication:

```sql
select *
from pg_publication_tables
where pubname = 'supabase_realtime';
```

Harus ada tabel `public.products`.

Pastikan user memang memiliki baris pada `workspace_members`.

Cek browser Console jika ada error RLS.

---

## Catatan notifikasi

Realtime sinkron berarti perubahan database dikirim ke semua browser yang sedang terhubung.
Alarm suara tetap tunduk pada kebijakan browser:
- user perlu berinteraksi/menekan tombol untuk mengaktifkan audio;
- halaman yang ditutup atau disuspend OS tidak dijamin berbunyi.

Agar notifikasi muncul saat website benar-benar ditutup, fase berikutnya adalah **Web Push + backend scheduler / Edge Function**.
