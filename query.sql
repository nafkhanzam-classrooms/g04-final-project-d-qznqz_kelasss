CREATE DATABASE IF NOT EXISTS quiz_db;
USE quiz_db;

CREATE TABLE rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pin VARCHAR(6) NOT NULL UNIQUE,
    status ENUM('waiting','started','ended')
        DEFAULT 'waiting',
    current_question_index INT DEFAULT 0,
    num_questions INT DEFAULT 5,
    timer_seconds INT DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id INT NOT NULL,
    username VARCHAR(50) NOT NULL,
    role ENUM('host','participant') NOT NULL,
    score INT DEFAULT 0,
    streak INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    session_token VARCHAR(255),
    last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    UNIQUE(room_id, username)
);

CREATE TABLE questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_text TEXT NOT NULL,
    option_a VARCHAR(255) NOT NULL,
    option_b VARCHAR(255) NOT NULL,
    option_c VARCHAR(255) NOT NULL,
    option_d VARCHAR(255) NOT NULL,
    correct_answer CHAR(1) NOT NULL
);

CREATE TABLE answers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    player_id INT NOT NULL,
    question_id INT NOT NULL,
    answer CHAR(1) NOT NULL,
    is_correct BOOLEAN NOT NULL,
    answer_time_ms INT DEFAULT 0,
    points_earned INT DEFAULT 0,
    streak_at_answer INT DEFAULT 0,
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
);

drop database quiz_db

-- soal
INSERT INTO questions
(question_text, option_a, option_b, option_c, option_d, correct_answer)
VALUES

(
'Rentang alamat Well-Known Ports yang dikelola oleh lembaga IANA berada pada angka...',
'0 - 1023',
'1024 - 49151',
'49152 - 65535',
'0 - 65535',
'A'
),

(
'Dalam bahasa pemrograman Python, konstanta tipe socket yang digunakan khusus untuk membangun jalur komunikasi TCP adalah...',
'SOCK_DGRAM',
'SOCK_STREAM',
'SOCK_RAW',
'SOCK_SEQPACKET',
'B'
),

(
'Urutan pemanggilan fungsi (metode) socket dasar yang benar pada sisi Server untuk komunikasi TCP adalah...',
'socket() -> bind() -> listen() -> accept() -> recv() / send()',
'socket() -> connect() -> recv() / send()',
'socket() -> bind() -> recvfrom() / sendto()',
'socket() -> listen() -> bind() -> accept() -> recv() / send()',
'A'
),

(
'Apa fungsi utama dari alat bantu seperti ngrok dalam pengembangan aplikasi jaringan?',
'Melakukan kompresi data (zipping) sebelum dikirim ke luar jaringan',
'Membagi beban lalu lintas jaringan secara merata ke banyak komputer',
'Membuat secure tunnel untuk mengekspos server lokal (di balik NAT) ke internet publik',
'Mengenkripsi password klien yang dikirim menuju server',
'C'
),

(
'Masalah atau keterbatasan utama pada sebuah blocking server sederhana yang tidak dimodifikasi adalah...',
'Membutuhkan alokasi memori RAM yang sangat besar',
'Alamat IP server akan selalu berubah-ubah setiap saat',
'Proses pengiriman data otomatis terenkripsi sehingga sulit dibaca',
'Hanya dapat melayani dan merespons satu klien pada satu waktu',
'D'
),

(
'Modul bawaan di Python yang umum digunakan untuk melakukan I/O Multiplexing dalam memantau banyak socket sekaligus secara paralel adalah...',
'threading',
'subprocess',
'select',
'multiprocessing',
'C'
),

(
'Spesifikasi standar protokol HTTP/1.1 didokumentasikan pertama kali dalam RFC bernomor...',
'RFC 959',
'RFC 854',
'RFC 2616',
'RFC 1050',
'C'
),

(
'Manakah dari komponen berikut yang bukan merupakan bagian struktur dari sebuah pesan HTTP Request?',
'Request Line',
'Status Code',
'Headers',
'Message Body',
'B'
),

(
'Jika sebuah request klien berhasil diproses dengan baik oleh web server, kode status HTTP berapakah yang akan dikembalikan?',
'404 Not Found',
'301 Moved Permanently',
'500 Internal Server Error',
'200 OK',
'D'
),

(
'Perbedaan mendasar antara metode permintaan HTTP GET dan HTTP POST adalah...',
'GET menyertakan parameter data langsung di URL, sedangkan POST menempatkan data secara tersembunyi di dalam Message Body.',
'GET hanya dapat meminta file gambar, sedangkan POST khusus untuk teks.',
'GET membutuhkan sistem autentikasi, sedangkan POST tidak membutuhkan kredensial.',
'GET dijalankan oleh server, sedangkan POST dijalankan oleh klien.',
'A'
),

(
'Tipe socket yang harus diinisialisasi pada Python untuk melakukan komunikasi menggunakan protokol UDP adalah...',
'SOCK_STREAM',
'SOCK_DGRAM',
'SOCK_PACKET',
'SOCK_RAW',
'B'
),

(
'Karakteristik mana di bawah ini yang paling tepat mendeskripsikan sifat pengiriman data dengan UDP?',
'Menjamin seluruh paket data sampai di tujuan secara lengkap dan berurutan',
'Wajib melakukan proses Three-way Handshake sebelum data dikirimkan',
'Cepat namun tidak memiliki mekanisme garansi jika ada paket data yang hilang di jalan',
'Sangat ideal untuk proses download dokumen rahasia perusahaan',
'C'
),

(
'Dalam arsitektur File Transfer Protocol (FTP) RFC 959, jalur komunikasinya dibagi menjadi dua koneksi terpisah, yaitu...',
'Input Channel dan Output Channel',
'Upload Channel dan Download Channel',
'Command Channel dan Response Channel',
'Control Channel dan Data Channel',
'D'
),

(
'Library bawaan Python yang digunakan untuk membangun program FTP Client secara mandiri adalah...',
'requests',
'ftplib',
'urllib',
'pyftpdlib',
'B'
),

(
'Proses mengubah (packing) objek tipe data yang kompleks di Python menjadi bentuk bit/bytes agar dapat ditransmisikan menyeberangi jaringan disebut dengan...',
'Port Forwarding',
'Load Balancing',
'Object Serialization',
'I/O Multiplexing',
'C'
);
