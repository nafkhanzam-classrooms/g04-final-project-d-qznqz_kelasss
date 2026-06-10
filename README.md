# 🏆 QuITS - Quiz Interactive Time-bound System

[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/4SHtB1vz)

QuITS adalah aplikasi kuis interaktif *real-time* berbasis web yang dirancang untuk menciptakan suasana kelas yang seru, kompetitif, dan menghibur. Terinspirasi dari platform seperti Kahoot! dan Quizizz, QuITS menambahkan sentuhan unik berupa integrasi meme otomatis berdasarkan performa pemain, fitur *WebRTC Screen Sharing* langsung di dalam aplikasi, serta penyimpanan data berbasis MySQL.

---

## 🚀 Fitur Utama

* **Komunikasi Real-Time Berlatensi Rendah:** Menggunakan protokol WebSockets kustom untuk perpindahan soal, aktivitas *live*, dan pembaruan papan skor secara instan.
* **Integrasi Database Performa Tinggi:** Menyimpan data pengguna, histori kuis, dan papan peringkat secara persisten menggunakan MySQL.
* **Resiliensi Sesi (Resume Session):** Dilengkapi tokenisasi via `sessionStorage`. Jika jaringan terputus atau halaman tidak sengaja ter-*refresh*, pengguna akan langsung kembali ke sesi kuis tanpa kehilangan data atau skor.
* **WebRTC Screen Sharing terintegrasi:** Host (Dosen/Guru) dapat memberikan otorisasi kepada peserta (Mahasiswa/Siswa) tertentu untuk membagikan layar mereka secara *peer-to-peer* (P2P) kepada seluruh ruang kuis menggunakan STUN Server publik milik Google.
* **Sistem Penilaian Dinamis & Streak Multiplier:**
  * **Poin Dasar:** 3 × durasi timer untuk setiap jawaban benar.
  * **Bonus Kecepatan:** Menjawab dalam 3 detik pertama memberikan poin penuh. Setelah itu, poin berkurang 1 poin per detik.
  * **Streak Bonus:** Beruntun menjawab benar akan meningkatkan pengali skor (x1 → x1.125 → x1.25, dst). Jawaban salah akan meriset *streak* kembali ke 0.
* **Fitur Interaktivitas & Anti-Gabut:**
  * **🕹️ Bored Button:** Tombol interaktif mini di pojok kartu untuk diklik peserta saat bosan menunggu.
  * **Floating Reactions:** Fitur kirim emoji melayang bebas spam di sisi peserta, namun memiliki filter anti-spam pintar di sisi Host agar *Live Activity Feed* tetap rapi.
  * **✋ Raise Hand System:** Tombol angkat tangan digital yang statusnya langsung terpantau secara *real-time* oleh Host.

---

## 🛠️ Tutorial Menyalakan Aplikasi

Ikuti urutan langkah di bawah ini untuk menyiapkan database dan menjalankan server aplikasi.

### Langkah 1: Buat Database di MySQL
1. Buka *database manager* pilihan Anda (seperti phpMyAdmin, MySQL Workbench, atau via Terminal MySQL).
2. Buat database baru dengan nama yang sesuai dengan konfigurasi pada file `server.py` Anda (misalnya: `quits_db`).
3. Pastikan server MySQL Anda (XAMPP/Laragon/Native) sudah dalam status **Running**.

### Langkah 2: Install Dependensi Jaringan & Database
Buka terminal atau command prompt Anda, lalu instal penghubung websocket dan mysql dengan menjalankan perintah berikut:
```bash
pip install websockets mysql-connector-python

```

### Langkah 3: Jalankan Backend Server

Arahkan terminal ke dalam folder tempat Anda menyimpan berkas `server.py`, `app.js`, dan aset lainnya:

```bash
cd nama_folder_proyek_anda

```

*(Ganti `nama_folder_proyek_anda` dengan lokasi direktori riil di komputer Anda)*

Setelah berada di dalam folder yang benar, jalankan server Python dengan perintah:

```bash
python server.py

```

### Langkah 4: Jalankan Antarmuka Pengguna (Client)

Buka file `index.html` menggunakan browser.
