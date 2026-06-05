// ================= DATA MEME =================
const correctMemes = ['assets/memes/correct/c1.webp', 'assets/memes/correct/c2.webp', 'assets/memes/correct/c3.webp'];
const wrongMemes = ['assets/memes/wrong/w1.webp', 'assets/memes/wrong/w2.webp', 'assets/memes/wrong/w3.webp'];

// ================= WEBSOCKET & STATE =================
let ws;
const SERVER_URL = "ws://localhost:8765";

// Fungsi untuk menghubungkan WebSocket di setiap halaman
function connectWebSocket() {
    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
        console.log("Terhubung ke Server Quiz!");
        
        const pin = localStorage.getItem('roomPin');
        const username = localStorage.getItem('username');
        const role = localStorage.getItem('role');
        
        if (pin && username) {
            if (role === 'participant') {
                ws.send(`JOIN;${pin};${username};-`);
            } else if (role === 'host') {
                //Host mendaftar ulang ketika pindah ke lobby.html
                ws.send(`RECONNECT_HOST;${pin};${username};-`);
            }
        }
    };

    ws.onmessage = (event) => {
        const msg = event.data;
        console.log("Pesan dari Server:", msg);
        
        // Parsing Custom Protocol: ACTION;PIN;USERNAME;PAYLOAD
        const parts = msg.split(';');
        if (parts.length < 4) return;
        
        const action = parts[0];
        const pin = parts[1];
        const user = parts[2];
        const payload = parts[3];

        handleServerCommand(action, payload, user);
    };

    ws.onclose = () => {
        console.warn("Koneksi terputus. Mencoba reconnect...");
        setTimeout(connectWebSocket, 2000); // Reconnect setiap 2 detik jika server mati
    };
}

// Menjalankan koneksi saat file JS dimuat
connectWebSocket();

// ================= ROUTER PESAN DARI SERVER =================
function handleServerCommand(action, payload, user) {
    switch(action) {
        case "SUCCESS":
            // Tanggapan sukses saat Create atau Join pertama kali
            if (payload === "Room berhasil dibuat" || payload === "Berhasil bergabung") {
                if (!window.location.pathname.includes('lobby.html')) {
                    window.location.href = 'lobby.html';
                }
            } else if (payload === "Kuis dimulai") {
                if (!window.location.pathname.includes('quiz.html')) {
                    window.location.href = 'quiz.html';
                }
            }
            break;

        case "ERROR":
            alert("Error: " + payload);
            break;

        case "PLAYER_JOINED":
            if (document.getElementById('player-container')) {
                const list = document.getElementById('player-container');
                // Cek agar nama yang sama tidak dicetak berkali-kali
                if (!list.innerHTML.includes(`${user} bergabung`)) {
                    list.innerHTML += `<li id="player-${user}">🙋‍♂️ ${user} bergabung</li>`;
                }
            }
            break;

        case "QUIZ_STARTED":
            if (!window.location.pathname.includes('quiz.html')) {
                window.location.href = 'quiz.html';
            }
            break;

        case "SHOW_SLIDE":
            const slideData = payload.split('|');
            localStorage.setItem('currentQuestionIndex', slideData[0]);
            
            // Hapus overlay leaderboard jika sedang muncul saat soal baru dimulai
            const oldOverlay = document.getElementById('interim-leaderboard-overlay');
            if (oldOverlay) document.body.removeChild(oldOverlay);

            if (document.getElementById('question-text')) {
                document.getElementById('question-text').innerText = slideData[1];
                enableQuizButtons(); 
            }
            break;

        case "ANSWER_RESULT":
            const resultData = payload.split('|');
            const status = resultData[0];
            const newScore = resultData[1];
            localStorage.setItem('myScore', newScore);
            
            showMemeFeedback(status);
            break;

        case "LEADERBOARD_DATA":
            if (window.location.pathname.includes('leaderboard.html')) {
                renderFinalLeaderboardPage(payload);
            } else {
                showInterimLeaderboardOverlay(payload);
            }
            break;

        case "END_QUIZ":
            if (!window.location.pathname.includes('leaderboard.html')) {
                window.location.href = 'leaderboard.html';
            }
            break;
    }
}

// ================= LOGIKA HALAMAN INDEX =================
function handleCreateClass() {
    localStorage.clear();
    const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
    const hostName = "Host_" + Math.floor(Math.random() * 100);
    
    localStorage.setItem('role', 'host');
    localStorage.setItem('roomPin', randomPin);
    localStorage.setItem('username', hostName);
    
    ws.send(`CREATE;${randomPin};${hostName};-`);
}

function handleJoinClass() {
    const pin = document.getElementById('input-pin').value;
    const name = document.getElementById('input-name').value;

    if (!pin || !name) { alert("PIN dan Nama tidak boleh kosong!"); return; }

    localStorage.setItem('role', 'participant');
    localStorage.setItem('roomPin', pin);
    localStorage.setItem('username', name);
    localStorage.setItem('myScore', '0');
    
    ws.send(`JOIN;${pin};${name};-`);
}

// ================= LOGIKA HALAMAN LOBBY =================
function initLobbyPage() {
    const role = localStorage.getItem('role');
    const pin = localStorage.getItem('roomPin');
    if(!pin) return;

    document.getElementById('lobby-pin').innerText = pin;

    if (role === 'host') {
        document.getElementById('lobby-role').innerText = "Lobby Utama (Host)";
        document.getElementById('host-panel').style.display = 'block';
    } else {
        document.getElementById('lobby-role').innerText = "Lobby Peserta";
        document.getElementById('lobby-status').innerText = "Menunggu host memulai kuis...";
        document.getElementById('participant-panel').style.display = 'block';
    }
}

function handleStartQuiz() {
    const pin = localStorage.getItem('roomPin');
    const user = localStorage.getItem('username');
    ws.send(`START_QUIZ;${pin};${user};-`);
}

// ================= LOGIKA HALAMAN QUIZ =================
function initQuizPage() {
    const role = localStorage.getItem('role');
    if (role === 'host') {
        document.getElementById('quiz-title').innerText = "Sesi Kuis Berjalan (Layar Host)";
        document.getElementById('host-quiz-space').style.display = 'block';
        
        setTimeout(handleNextQuestion, 500); 
    } else {
        document.getElementById('quiz-title').innerText = "Pilih Jawaban Anda!";
        document.getElementById('participant-quiz-space').style.display = 'block';
        disableQuizButtons(); 
    }
}

function handleNextQuestion() {
    const pin = localStorage.getItem('roomPin');
    const user = localStorage.getItem('username');
    let idx = parseInt(localStorage.getItem('currentQuestionIndex') || '-1');
    idx++; 
    
    ws.send(`NEXT_SLIDE;${pin};${user};${idx}`);
}

function handleAnswer(selectedOption) {
    const pin = localStorage.getItem('roomPin');
    const user = localStorage.getItem('username');
    const qIndex = localStorage.getItem('currentQuestionIndex');
    
    ws.send(`ANSWER;${pin};${user};${qIndex}|${selectedOption}`);
    disableQuizButtons();
}

function handleEndQuiz() {
    const pin = localStorage.getItem('roomPin');
    const user = localStorage.getItem('username');
    ws.send(`NEXT_SLIDE;${pin};${user};999`); 
}

// ================= FITUR GAMIFIKASI: MEME POPUP =================
function showMemeFeedback(status) {
    let memeSrc = "";
    let titleText = "";
    
    if (status === "CORRECT") {
        memeSrc = correctMemes[Math.floor(Math.random() * correctMemes.length)];
        titleText = "BENAR! 🔥 +Poin Streak";
    } else {
        memeSrc = wrongMemes[Math.floor(Math.random() * wrongMemes.length)];
        titleText = "SALAH! 😭 Gapapa coba lagi";
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:flex; flex-direction:column; justify-content:center; align-items:center; z-index:9999;";
    
    const img = document.createElement('img');
    img.src = memeSrc;
    img.style.cssText = "max-width:80%; max-height:60%; border-radius:15px; border: 5px solid " + (status === 'CORRECT' ? '#2ecc71' : '#e74c3c');
    
    const title = document.createElement('h1');
    title.innerText = titleText;
    title.style.color = "white";
    title.style.marginTop = "20px";

    overlay.appendChild(img);
    overlay.appendChild(title);
    document.body.appendChild(overlay);

    setTimeout(() => {
        document.body.removeChild(overlay);
    }, 3000);
}

// ================= SHOW OVERLAY LEADERBOARD TIAP SOAL SELESAI =================
function showInterimLeaderboardOverlay(payload) {
    const exist = document.getElementById('interim-leaderboard-overlay');
    if (exist) document.body.removeChild(exist);

    const overlay = document.createElement('div');
    overlay.id = 'interim-leaderboard-overlay';
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:#013880; color:white; display:flex; flex-direction:column; justify-content:center; align-items:center; z-index:9999; padding:20px;";

    const title = document.createElement('h1');
    title.innerText = "📊 PAPAN SKOR SEMENTARA 📊";
    title.style.marginBottom = "20px";
    overlay.appendChild(title);

    const listContainer = document.createElement('ol');
    listContainer.style.cssText = "list-style:none; width:100%; max-width:450px; background:white; color:#2c3e50; padding:20px; border-radius:12px; box-shadow:0 10px 20px rgba(0,0,0,0.3);";

    const players = payload.split(',');
    const myUsername = localStorage.getItem('username');

    players.forEach((playerStr, index) => {
        const data = playerStr.split('|');
        const name = data[0];
        const score = data[1];
        const changeStatus = data[2];

        const rank = index + 1;
        let changeIndicator = "➖ Tetap";
        let indicatorColor = "#95a5a6";

        if (changeStatus.startsWith("UP")) {
            const num = changeStatus.split('_')[1];
            changeIndicator = `🔺 Naik ${num}`;
            indicatorColor = "#2ecc71";
        } else if (changeStatus.startsWith("DOWN")) {
            const num = changeStatus.split('_')[1];
            changeIndicator = `🔻 Turun ${num}`;
            indicatorColor = "#e74c3c";
        }

        const isMe = (name === myUsername) ? " (Kamu)" : "";
        const bgRow = (name === myUsername) ? "#f1c40f" : "#f8fafc";

        const li = document.createElement('li');
        li.style.styleText = ""; // Reset
        li.style.cssText = `background:${bgRow}; padding:12px; margin-bottom:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-weight:bold; border-left:5px solid ${indicatorColor};`;
        li.innerHTML = `
            <div>#${rank} ${name}${isMe}</div>
            <div style="text-align:right;">
                <div>${score} Pts</div>
                <small style="color:${indicatorColor}; font-size:11px;">${changeIndicator}</small>
            </div>
        `;
        listContainer.appendChild(li);
    });

    overlay.appendChild(listContainer);

    const textWait = document.createElement('p');
    textWait.innerText = "Bersiap untuk soal berikutnya dalam 5 detik...";
    textWait.style.marginTop = "20px";
    textWait.style.fontWeight = "bold";
    textWait.style.fontSize = "18px";
    textWait.style.color = "#f39c12";
    overlay.appendChild(textWait);

    document.body.appendChild(overlay);
}

// ================= RENDER DI HALAMAN LEADERBOARD AKHIR =================
function renderFinalLeaderboardPage(payload) {
    const playerListContainer = document.querySelector('.player-list');
    if (!playerListContainer) return;
    playerListContainer.innerHTML = "";

    const players = payload.split(',');
    players.forEach((playerStr, index) => {
        const data = playerStr.split('|');
        const name = data[0];
        const score = data[1];
        const rank = index + 1;

        let medal = `Rank ${rank}`;
        if (rank === 1) medal = "🥇";
        else if (rank === 2) medal = "🥈";
        else if (rank === 3) medal = "🥉";

        playerListContainer.innerHTML += `<li>${medal} <span>${name}</span> - ${score} Pts</li>`;
    });
}

// ================= UTILITAS =================
function disableQuizButtons() {
    document.querySelectorAll('.btn-quiz').forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
    });
}

function enableQuizButtons() {
    document.querySelectorAll('.btn-quiz').forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    });
}

function handleGoBack() {
    localStorage.clear();
    window.location.href = 'index.html';
} 
