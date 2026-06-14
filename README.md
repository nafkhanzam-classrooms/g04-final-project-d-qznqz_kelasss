# 🏆 QuITS - Quiz Interactive Time-bound System

> 🔗 **Tautan Penting:**
> * **▶️ Demo Aplikasi:** [Tonton Video Demo QuITS di Sini](https://www.google.com/search?q=%23masukkan-link-demo-aplikasi-di-sini)
> * **📁 Google Drive:** [Akses Dokumen dan Aset di Sini](https://www.google.com/search?q=%23masukkan-link-google-drive-di-sini)
> 
> 

QuITS adalah aplikasi kuis interaktif *real-time* berbasis web yang dirancang untuk menciptakan suasana kelas yang seru, kompetitif, dan menghibur. Terinspirasi dari platform seperti Kahoot! dan Quizizz, QuITS menambahkan sentuhan unik berupa integrasi meme otomatis berdasarkan performa pemain, fitur *WebRTC Screen Sharing* langsung di dalam aplikasi, serta penyimpanan data berbasis MySQL.

---

## 🚀 Fitur Utama

* **Komunikasi Real-Time Berlatensi Rendah:** Menggunakan protokol WebSockets kustom untuk perpindahan soal, aktivitas *live*, dan pembaruan papan skor secara instan.
* **Integrasi Database Performa Tinggi:** Menyimpan data pengguna, histori kuis, dan papan peringkat secara persisten menggunakan MySQL.
* **Resiliensi Sesi (Resume Session):** Dilengkapi tokenisasi via `sessionStorage`. Jika jaringan terputus atau halaman tidak sengaja ter-*refresh*, pengguna akan langsung kembali ke sesi kuis tanpa kehilangan data atau skor.
* **WebRTC Screen Sharing terintegrasi:** Host (Dosen/Guru) dapat memberikan otorisasi kepada peserta (Mahasiswa/Siswa) tertentu untuk membagikan layar mereka secara *peer-to-peer* (P2P) kepada seluruh ruang kuis menggunakan STUN Server publik milik Google.
* **Sistem Penilaian Dinamis & Streak Multiplier:**
* **Poin Dasar:** Berbasis kecepatan, batas maksimum 250 poin (dalam 3 detik pertama). Poin akan berkurang jika menjawab lebih lama.
* **Streak Bonus:** Beruntun menjawab benar akan meningkatkan pengali skor (x1 → x1.125 → x1.25, dst). Jawaban salah akan meriset *streak* kembali ke 0.


* **Fitur Interaktivitas & Anti-Gabut:**
* **🕹️ Bored Button:** Tombol interaktif mini di pojok layar untuk diklik peserta saat bosan menunggu.
* **✨ Focus Check (Clicker):** Pop-up kejutan yang menguji refleks peserta untuk mendapatkan bonus poin instan.
* **Floating Reactions:** Fitur kirim emoji melayang bebas spam di sisi peserta, dengan filter pintar di sisi Host agar *Live Activity Feed* tetap rapi.
* **✋ Raise Hand System:** Tombol angkat tangan digital yang statusnya langsung terpantau secara *real-time* oleh Host.



---

## 🛠️ Tutorial Menyalakan Aplikasi

Ikuti urutan langkah di bawah ini untuk menyiapkan database dan menjalankan server aplikasi.

### Langkah 1: Setup Database MySQL

1. Pastikan server MySQL Anda (XAMPP/Laragon/Native) sudah dalam status **Running**.
2. Buka *database manager* pilihan Anda (seperti phpMyAdmin, MySQL Workbench, atau via Terminal MySQL).
3. Buat database baru bernama `quiz_db` (sesuai konfigurasi pada `server.py`).
4. **Penting:** Import/Eksekusi file `query.sql` yang tersedia di repositori ini ke dalam database `quiz_db`. Langkah ini akan secara otomatis membuat struktur tabel yang dibutuhkan sekaligus memasukkan set soal default.

### Langkah 2: Install Dependensi Jaringan & Database

Buka terminal atau command prompt Anda, lalu instal *library* Python yang dibutuhkan dengan menjalankan perintah berikut:

```bash
pip install websockets mysql-connector-python

```

### Langkah 3: Jalankan Backend Server

Arahkan terminal ke dalam folder tempat Anda menyimpan berkas `server.py`, `app.js`, dan aset lainnya:

```bash
cd lokasi/ke/folder/proyek/anda

```

Setelah berada di dalam folder yang benar, jalankan server Python dengan perintah:

```bash
python server.py

```

*(Pastikan terminal tetap terbuka dan menampilkan log "🚀 Server Quiz berjalan di ws://localhost:8765")*

### Langkah 4: Jalankan Antarmuka Pengguna (Client)

> ⚠️ **Catatan:** Fitur WebRTC (Screen Sharing) di browser modern **membutuhkan** protokol HTTP (`http://localhost` atau `https://`). Jangan membuka file `index.html` secara langsung dengan *double-click* (`file:///`).

Untuk menjalankan *frontend*, buka terminal baru di folder proyek Anda dan gunakan HTTP Server bawaan Python:

```bash
python -m http.server 8000

```

*(Alternatif: Gunakan ekstensi "Live Server" di VS Code).*

Selanjutnya, buka browser web Anda dan akses:
👉 **http://localhost:8000**

---

## 🎮 Cara Bermain (Simulasi Kuis)

1. **Sebagai Host (Dosen/Guru):**
* Buka browser dan klik tombol **Buat Kelas Baru (Host) 👨‍🏫**.
* Anda akan masuk ke Lobi Host. Salin atau bagikan **PIN Kelas** berukuran besar yang tampil di layar kepada peserta.
* Pantau daftar peserta yang masuk, lalu klik **Mulai Kuis 🚀** jika semua sudah siap.


2. **Sebagai Peserta (Mahasiswa):**
* Buka browser di perangkat/tab lain.
* Masukkan **PIN Kelas** yang diberikan oleh Host beserta **Nama** Anda.
* Klik **Gabung Kelas 🙋**.
* Tunggu aba-aba, dan bersiaplah memilih jawaban (▲, ✖, ●, ■) secepat mungkin!



---

## 💻 Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript.
* **Backend:** Python 3 (`websockets`, `asyncio`).
* **Database:** MySQL (`mysql-connector-python`).
* **P2P Video Signaling:** WebRTC RTCPeerConnection.
