// Data Dummy Pertanyaan Kuis
const questions = [
    { text: "[Soal 1] Manakah yang merupakan protokol lapisan transport yang bersifat connection-oriented?", correct: "B" }, 
    { text: "[Soal 2] Fitur WebSocket bekerja pada layer aplikasi dan menggunakan port default berberapa?", correct: "C" }, 
    { text: "[Soal 3] Mengapa threading diperlukan pada implementasi server aplikasi interaktif?", correct: "A" } 
];

// ================= LOGIKA UMUM & NAVIGASI BACK =================
function handleGoBack() {
    // Bersihkan sesi saat ini agar tidak bengkalaian di lokal browser
    localStorage.clear();
    window.location.href = 'index.html';
}

// ================= LOGIKA HALAMAN INDEX =================
function handleCreateClass() {
    localStorage.clear(); // reset instan sebelum membuat baru
    const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
    localStorage.setItem('role', 'host');
    localStorage.setItem('roomPin', randomPin);
    localStorage.setItem('quizStatus', 'waiting');
    localStorage.setItem('currentQuestionIndex', '0');
    window.location.href = 'lobby.html';
}

function handleJoinClass() {
    localStorage.clear(); // reset instan sebelum bergabung baru
    const pin = document.getElementById('input-pin').value;
    const name = document.getElementById('input-name').value;

    if (!pin || !name) {
        alert("PIN dan Nama tidak boleh kosong!");
        return;
    }

    localStorage.setItem('role', 'participant');
    localStorage.setItem('roomPin', pin);
    localStorage.setItem('username', name);
    localStorage.setItem('myScore', '0');
    window.location.href = 'lobby.html';
}

// ================= LOGIKA HALAMAN LOBBY =================
function initLobbyPage() {
    const role = localStorage.getItem('role');
    const pin = localStorage.getItem('roomPin');
    
    if(!pin) { window.location.href = 'index.html'; return; } // Proteksi jika lompati halaman
    document.getElementById('lobby-pin').innerText = pin;

    const playerContainer = document.getElementById('player-container');

    if (role === 'host') {
        document.getElementById('lobby-role').innerText = "Lobby Utama (Host)";
        document.getElementById('host-panel').style.display = 'block';
        
        // Simulasikan bot/pemain lain masuk
        setTimeout(() => { playerContainer.innerHTML += '<li>🤖 Budi Wijaya masuk kelas</li>'; }, 1000);
        setTimeout(() => { playerContainer.innerHTML += '<li>🤖 Andi S. masuk kelas</li>'; }, 2500);
    } else {
        document.getElementById('lobby-role').innerText = "Lobby Peserta";
        document.getElementById('lobby-status').innerText = "Berhasil masuk! Menunggu host memulai kuis...";
        document.getElementById('participant-panel').style.display = 'block';
        
        const myName = localStorage.getItem('username');
        playerContainer.innerHTML += `<li>🙋‍♂️ ${myName} (Anda)</li>`;
    }

    // LISTENER: Mendeteksi Host memulai kuis dari tab sebelah
    window.addEventListener('storage', (e) => {
        if (e.key === 'quizStatus' && e.newValue === 'started') {
            window.location.href = 'quiz.html';
        }
    });
}

function handleStartQuiz() {
    localStorage.setItem('quizStatus', 'started');
    window.location.href = 'quiz.html';
}

// ================= LOGIKA HALAMAN QUIZ =================
function initQuizPage() {
    const role = localStorage.getItem('role');
    if(!localStorage.getItem('roomPin')) { window.location.href = 'index.html'; return; }

    updateQuestionUI();

    if (role === 'host') {
        document.getElementById('quiz-title').innerText = "Sesi Kuis Berjalan (Layar Host)";
        document.getElementById('host-quiz-space').style.display = 'block';
    } else {
        document.getElementById('quiz-title').innerText = "Pilih Jawaban Anda!";
        document.getElementById('participant-quiz-space').style.display = 'block';
        enableQuizButtons(); // Pastikan tombol menyala di awal soal
    }

    // LISTENER: Sinkronisasi antar Tab secara Real-Time
    window.addEventListener('storage', (e) => {
        if (e.key === 'currentQuestionIndex') {
            updateQuestionUI();
            enableQuizButtons(); // Nyalakan kembali tombol untuk soal berikutnya
        }
        if (e.key === 'quizStatus' && e.newValue === 'ended') {
            window.location.href = 'leaderboard.html';
        }
    });
}

function updateQuestionUI() {
    const idx = parseInt(localStorage.getItem('currentQuestionIndex') || '0');
    if (idx < questions.length) {
        document.getElementById('question-text').innerText = questions[idx].text;
    }
}

function handleAnswer(selectedOption) {
    const idx = parseInt(localStorage.getItem('currentQuestionIndex') || '0');
    const correctAnswer = questions[idx].correct;
    let currentScore = parseInt(localStorage.getItem('myScore') || '0');

    if (selectedOption === correctAnswer) {
        currentScore += 1000;
        localStorage.setItem('myScore', currentScore.toString());
        alert("Jawaban disimpan! (BENAR 👍)");
    } else {
        alert("Jawaban disimpan! (SALAH ❌)");
    }

    disableQuizButtons(); // Kunci tombol agar tidak bisa spam jawaban di soal yang sama
}

// Mematikan tombol setelah menjawab (Ditaruh di dalam fungsi dengan benar)
function disableQuizButtons() {
    document.querySelectorAll('.btn-quiz').forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
    });
}

// Menyalakan kembali tombol saat pindah soal
function enableQuizButtons() {
    document.querySelectorAll('.btn-quiz').forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    });
}

function handleNextQuestion() {
    let idx = parseInt(localStorage.getItem('currentQuestionIndex') || '0');
    idx++;
    if (idx < questions.length) {
        localStorage.setItem('currentQuestionIndex', idx.toString());
        updateQuestionUI();
    } else {
        handleEndQuiz();
    }
}

function handleEndQuiz() {
    localStorage.setItem('quizStatus', 'ended');
    window.location.href = 'leaderboard.html';
}