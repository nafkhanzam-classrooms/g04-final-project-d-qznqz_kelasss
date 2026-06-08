// GLOBAL STATE
let socket = null;
const WS_URL = "ws://localhost:8765";
let currentQuestionIndex = 0;
let transitionLock = false;
let alreadyAnswered = false;
let lobbyPlayers = [];
let questionTimestamp = 0;  // Track when question was shown
let timerInterval = null;  // Timer for display
let lobbyRefreshInterval = null;  // Polling for host lobby updates

// ==========================================
// SESSION STORAGE HELPERS 
// ==========================================
function saveSession(pin, username, role, token) {
    sessionStorage.setItem("pin", pin);
    sessionStorage.setItem("username", username);
    sessionStorage.setItem("role", role);
    sessionStorage.setItem("token", token);
}
function getPin() { return sessionStorage.getItem("pin"); }
function getUsername() { return sessionStorage.getItem("username"); }
function getRole() { return sessionStorage.getItem("role"); }
function getToken() { return sessionStorage.getItem("token"); }
function clearSession() { sessionStorage.clear(); }

// ==========================================
// WEBSOCKET CONNECTION
// ==========================================
function connectWebSocket() {
    return new Promise((resolve, reject) => {
        socket = new WebSocket(WS_URL);
        socket.onopen = () => { resolve(); };
        socket.onerror = (err) => { reject(err); };
        socket.onmessage = handleServerMessage;
    });
}

function sendPacket(action, pin, username, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(`${action};${pin};${username};${payload}`);
}

async function tryResumeSession() {
    const token = getToken();
    if (!token) return;
    await connectWebSocket();
    sendPacket("RESUME", getPin(), getUsername(), token);
}

function startHeartbeat() {
    setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            sendPacket("PING", getPin(), getUsername(), "-");
        }
    }, 20000);
}

// ==========================================
// ROUTER & NAVIGATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const page = window.location.pathname.split("/").pop();
    if (page === "index.html" || page === "") {
        initIndexPage();
    } else if (page === "lobby.html") {
        initLobbyPage();
    } else if (page === "quiz.html") {
        initQuizPage();
    } else if (page === "leaderboard.html") {
        initLeaderboardPage();
    }
});

function goToLobby() { window.location.href = "lobby.html"; }
function goToQuiz() { window.location.href = "quiz.html"; }
function goToLeaderboard() { window.location.href = "leaderboard.html"; }

function handleGoBack() {
    const role = getRole();
    const confirmed = confirm(
        role === "host" 
            ? "Yakin ingin keluar? Kelas akan dihapus dan semua peserta akan dikeluarkan."
            : "Yakin ingin keluar dari kelas?"
    );
    
    if (confirmed) {
        if (role === "host") {
            sendPacket("DELETE_ROOM", getPin(), getUsername(), "-");
        } else if (role === "participant") {
            sendPacket("LEAVE", getPin(), getUsername(), "-");
        }
        clearSession();
        window.location.href = "index.html";
    }
}

function clearAndGoHome() {
    if (confirm("Yakin ingin kelar dari kuis? Hasil tidak akan disimpan.")) {
        clearSession();
        window.location.href = "index.html";
    }
}

// ==========================================
// MESSAGE ROUTER
// ==========================================
function handleServerMessage(event) {
    const parts = event.data.split(";", 4);
    if(parts.length < 4) return;

    const action = parts[0];
    const pin = parts[1];
    const sender = parts[2]; 
    const payload = parts[3];

    switch(action) {
        case "ERROR": alert(payload); break;
        case "ROOM_CREATED": onRoomCreated(pin, sender, payload); break; 
        case "JOIN_SUCCESS": onJoinSuccess(pin, sender, payload); break;
        case "RESUME_SUCCESS": onResumeSuccess(pin, sender, payload); break;
        case "PLAYER_JOINED": onPlayerJoined(sender); break;
        case "PLAYER_LEFT": onPlayerLeft(sender); break;
        case "PLAYER_LIST": onPlayerList(payload); break;
        case "ROOM_DELETED": onRoomDeleted(payload); break;
        case "QUIZ_STARTED": onQuizStarted(); break;
        case "SHOW_QUESTION": onShowQuestion(payload); break;
        case "ANSWER_RESULT": onAnswerResult(payload); break;
        case "PLAYER_ANSWERED": onPlayerAnswered(sender); break; // Payload skor tidak dipakai lagi
        case "LEADERBOARD_DATA": onLeaderboardData(payload); break;
        case "TEMP_LEADERBOARD": onTempLeaderboard(payload); break; // Tangkap event 5 detik
        case "FINAL_LEADERBOARD": onFinalLeaderboard(payload); break;
        case "QUIZ_ENDED": onQuizEnded(); break;
    }
}

// ==========================================
// INDEX PAGE 
// ==========================================
async function initIndexPage() {
    const token = getToken();
    if (!token) return;
    try { await tryResumeSession(); } catch(err) {}
}

async function handleCreateClass() {
    const username = "Host_" + Math.floor(Math.random() * 100);
    try {
        await connectWebSocket();
        sendPacket("CREATE", "-", username, "-");
    } catch(err) { alert("Gagal koneksi server."); }
}

async function handleJoinClass() {
    const pin = document.getElementById("input-pin")?.value.trim();
    const username = document.getElementById("input-name")?.value.trim();
    if (!pin || !username) return alert("PIN dan Nama wajib diisi.");
    try {
        await connectWebSocket();
        sendPacket("JOIN", pin, username, "-");
    } catch(err) { alert("Gagal koneksi server."); }
}

function onRoomCreated(pin, username, token) {
    saveSession(pin, username, "host", token);
    goToLobby();
}

function onJoinSuccess(pin, username, token) {
    saveSession(pin, username, "participant", token);
    goToLobby();
}

function onResumeSuccess(pin, username, role) {
    sessionStorage.setItem("pin", pin);
    sessionStorage.setItem("username", username);
    sessionStorage.setItem("role", role);
    const page = window.location.pathname.split("/").pop();
    if (page === "index.html" || page === "") goToLobby();
}

// ==========================================
// LOBBY PAGE
// ==========================================
async function initLobbyPage() {
    const pin = getPin();
    const username = getUsername();
    const role = getRole();
    if (!pin || !username) return window.location.href = "index.html";

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        await tryResumeSession();
    }
    startHeartbeat();

    const pinLabel = document.getElementById("lobby-pin");
    if (pinLabel) pinLabel.innerText = pin;

    const roleLabel = document.getElementById("lobby-role");
    if (roleLabel) roleLabel.innerText = role === "host" ? "Lobby Host 👨‍🏫" : "Lobby Peserta 🙋";

    if(role === "host") {
        document.getElementById("host-panel").style.display = "block";
        // Get initial player list (no more polling - will update via PLAYER_JOINED/PLAYER_LEFT broadcasts)
        sendPacket("GET_PLAYERS", getPin(), getUsername(), "-");

        // Add event listener for timer settings
        const timerInput = document.getElementById("timer-seconds");
        if(timerInput) {
            timerInput.addEventListener("change", updateMaxPointsDisplay);
            timerInput.addEventListener("input", updateMaxPointsDisplay);
            updateMaxPointsDisplay();
        }
    } else {
        document.getElementById("participant-panel").style.display = "block";
        const pc = document.getElementById("player-container");
        if(pc) pc.innerHTML = "<li style='text-align:center; list-style:none;'>Semangat ya! 👀</li>";
        const count = document.getElementById("participant-count");
        if(count) count.style.display = "none";
    }
}

function updateMaxPointsDisplay() {
    const timerInput = document.getElementById("timer-seconds");
    if(!timerInput) return;
    
    const timerSeconds = parseInt(timerInput.value) || 30;
    // Display formula instead of exact value
    const display = document.getElementById("max-points-display");
    if(display) {
        display.innerText = `3 × ${timerSeconds}`;
    }
}

function updateParticipantCount() {
    const counter = document.getElementById("participant-count");
    if (counter) counter.innerText =`${lobbyPlayers.length} / 10 peserta`;
}

function renderPlayerList() {
    if (getRole() !== "host") return;
    const container = document.getElementById("player-container");
    if (!container) return;
    container.innerHTML = "";
    lobbyPlayers.forEach(player => {
        const li = document.createElement("li");
        li.innerText = `🏃 ${player}`;
        container.appendChild(li);
    });
    updateParticipantCount();
}

function onPlayerJoined(username) {
    if (getRole() !== "host") return; 
    if (!lobbyPlayers.includes(username)) lobbyPlayers.push(username);
    renderPlayerList();
    // Request fresh player list to ensure accuracy
    sendPacket("GET_PLAYERS", getPin(), getUsername(), "-");
}

function onPlayerLeft(username) {
    if (getRole() !== "host") return;
    lobbyPlayers = lobbyPlayers.filter(p => p !== username);
    renderPlayerList();
    // Request fresh player list to ensure accuracy
    sendPacket("GET_PLAYERS", getPin(), getUsername(), "-");
}

function onRoomDeleted(payload) {
    alert("Kelas telah dihapus.");
    clearSession();
    window.location.href = "index.html";
}

function onPlayerList(payload) {
    if (getRole() !== "host") return;
    lobbyPlayers = payload && payload.trim() !== "" ? payload.split(",") : [];
    renderPlayerList();
}

function handleStartQuiz() {
    if(getRole() !== "host") return;
    
    // Validate at least 1 player joined
    if(lobbyPlayers.length === 0) return alert("Minimal 1 peserta harus bergabung sebelum memulai kuis");
    
    const numQuestions = parseInt(document.getElementById("num-questions")?.value) || 5;
    const timerSeconds = parseInt(document.getElementById("timer-seconds")?.value) || 30;
    
    // Validate inputs
    if(numQuestions < 1) return alert("Jumlah soal minimal 1");
    if(timerSeconds < 5) return alert("Timer minimal 5 detik");
    
    // Store settings in sessionStorage for reference
    sessionStorage.setItem("numQuestions", numQuestions);
    sessionStorage.setItem("timerSeconds", timerSeconds);
    
    // Send settings with START_QUIZ
    sendPacket("START_QUIZ", getPin(), getUsername(), `${numQuestions}|${timerSeconds}`);
}

// ==========================================
// QUIZ PAGE
// ==========================================
function onQuizStarted() {
    sessionStorage.setItem("quizStarted", "true");
    
    // Stop lobby polling
    if(lobbyRefreshInterval) {
        clearInterval(lobbyRefreshInterval);
        lobbyRefreshInterval = null;
    }
    
    const page = window.location.pathname.split("/").pop();
    if (page !== "quiz.html") goToQuiz();
}

async function initQuizPage() {
    const pin = getPin();
    if(!pin) return window.location.href = "index.html";
    if(!socket || socket.readyState !== WebSocket.OPEN) await tryResumeSession();
    
    startHeartbeat();
    if(getRole() === "host") {
        document.getElementById("host-quiz-space").style.display = "block";
    } else {
        document.getElementById("participant-quiz-space").style.display = "block";
    }
}

function onTempLeaderboard(payload) {
    // Saat jeda 5 detik
    if(getRole() === "participant") {
        document.getElementById("participant-quiz-space").style.display = "none";
        document.getElementById("meme-image").style.display = "none";
        document.getElementById("answer-feedback").innerHTML = "";
        
        document.getElementById("question-text").innerText = "Menyiapkan soal berikutnya...";
        document.getElementById("question-number").innerText = "Sabar ya...";
        
        const tempBoard = document.getElementById("participant-temp-leaderboard");
        const list = document.getElementById("participant-temp-list");
        
        if(tempBoard && list) {
            tempBoard.style.display = "block";
            list.innerHTML = "";
            const rows = payload.split(",");
            rows.forEach((row, idx) => {
                const p = row.split("|");
                if(p.length < 2) return;
                const li = document.createElement("li");
                li.style.padding = "10px";
                li.style.borderBottom = "1px solid #ccc";
                let medal = `${idx + 1}.`;
                if (idx === 0) medal = "🥇";
                if (idx === 1) medal = "🥈";
                if (idx === 2) medal = "🥉";
                li.innerHTML = `<strong>${medal} ${p[0]}</strong> <span style="float:right;">${p[1]} pts</span>`;
                list.appendChild(li);
            });
        }
    } else if(getRole() === "host") {
        onLeaderboardData(payload);
    }
}

function onShowQuestion(payload) {
    alreadyAnswered = false;
    ["btnA","btnB","btnC","btnD"].forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.disabled = false;
    });

    if(getRole() === "participant") {
        document.getElementById("participant-temp-leaderboard").style.display = "none";
        document.getElementById("participant-quiz-space").style.display = "block";
    }

    document.getElementById("meme-image").style.display = "none";
    document.getElementById("answer-feedback").innerHTML = "";

    const parts = payload.split("|");
    if(parts.length < 6) return;

    currentQuestionIndex = parseInt(parts[0]);
    questionTimestamp = parts.length > 6 ? parseInt(parts[6]) : Date.now();  // Get server timestamp or use local
    
    document.getElementById("question-number").innerText = `Soal #${currentQuestionIndex + 1}`;
    document.getElementById("question-text").innerText = parts[1];
    document.getElementById("btnA").innerText = `▲ ${parts[2]}`;
    document.getElementById("btnB").innerText = `✖ ${parts[3]}`;
    document.getElementById("btnC").innerText = `● ${parts[4]}`;
    document.getElementById("btnD").innerText = `■ ${parts[5]}`;

    // Kosongkan log per soal
    const feed = document.getElementById("live-activity-list");
    if(feed) feed.innerHTML = "";
    
    // Start timer display for participants
    if(getRole() === "participant") {
        const timerDisplay = document.getElementById("timer-display");
        if(timerDisplay) timerDisplay.style.display = "block";
        
        // Clear previous timer
        if(timerInterval) clearInterval(timerInterval);
        
        // Start new timer
        timerInterval = setInterval(() => {
            const elapsed = (Date.now() - questionTimestamp) / 1000;
            const timerElement = document.getElementById("timer");
            if(timerElement) timerElement.innerText = elapsed.toFixed(1);
        }, 100);
    }
}

function handleAnswer(answer) {
    if(alreadyAnswered) return;
    alreadyAnswered = true;
    ["btnA","btnB","btnC","btnD"].forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.disabled = true;
    });
    
    // Stop timer
    if(timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    const answerTimestamp = Date.now();  // Get current time in milliseconds
    sendPacket("ANSWER", getPin(), getUsername(), `${currentQuestionIndex}|${answer}|${answerTimestamp}`);
}

function onAnswerResult(payload) {
    const parts = payload.split("|");
    const status = parts[0];
    const score = parts[1];
    const streak = parts[2];
    const basePoints = parts.length > 3 ? parseInt(parts[3]) : 0;
    const streakBonus = parts.length > 4 ? parseInt(parts[4]) : 0;
    const answerTimeMs = parts.length > 5 ? parseInt(parts[5]) : 0;
    const multiplier = parts.length > 6 ? parseFloat(parts[6]) : 1.0;
    
    sessionStorage.setItem("myScore", score);
    const feedback = document.getElementById("answer-feedback");
    const meme = document.getElementById("meme-image");
    const timerDisplay = document.getElementById("timer-display");
    
    if(!feedback) return;
    
    // Hide timer
    if(timerDisplay) timerDisplay.style.display = "none";
    
    const timeSeconds = (answerTimeMs / 1000).toFixed(2);
    
    if(status === "CORRECT") {
        feedback.innerHTML = `
            <h3 style="color:var(--green);">✅ Benar!</h3>
            <p style="margin: 10px 0; font-weight: bold; font-size: 24px; color: var(--green);">+${streakBonus} 🔥</p>
            <p style="margin: 5px 0; font-size: 14px; color: var(--primary);">Streak: ${streak}</p>
        `;
        meme.src = `assets/correct/correct${Math.floor(Math.random()*3)+1}.jpg`;
    } else {
        feedback.innerHTML = `
            <h3 style="color:var(--red);">❌ Salah!</h3>
            <p style="margin: 10px 0; font-weight: bold; font-size: 24px; color: var(--red);">+0 pts</p>
            <p style="margin: 5px 0; font-size: 14px; color: #e74c3c;">Streak reset</p>
        `;
        meme.src = `assets/wrong/wrong${Math.floor(Math.random()*3)+1}.jpg`;
    }
    meme.style.display = "block";
}

function onPlayerAnswered(username) {
    // Tampilan host cukup memunculkan info sudah menjawab
    const feed = document.getElementById("live-activity-list");
    if(!feed) return;
    const li = document.createElement("li");
    li.style.padding = "8px 12px";
    li.style.background = "#ffffff";
    li.style.borderBottom = "1px solid #eee";
    li.innerText = `⚡ ${username} sudah menjawab`;
    feed.prepend(li);
}

function handleNextQuestion() {
    if(transitionLock) return;
    transitionLock = true;
    const btn = document.getElementById("next-question-btn");
    if(btn) btn.disabled = true;

    sendPacket("NEXT_QUESTION", getPin(), getUsername(), "-");
    
    // Lock dibuka setelah 6 detik (sesuai jeda server 5 detik + buffer)
    setTimeout(() => {
        transitionLock = false;
        if(btn) btn.disabled = false;
    }, 6000);
}

function handleEndQuiz() {
    if(!confirm("Yakin ingin mengakhiri kuis sekarang dan melihat hasil?")) return;
    sendPacket("END_QUIZ", getPin(), getUsername(), "-");
}

function onLeaderboardData(payload) {
    if(!payload || payload === "-") return;
    const tempContainer = document.getElementById("temp-leaderboard-list");
    if(!tempContainer || getRole() !== "host") return;

    tempContainer.innerHTML = "";
    const rows = payload.split(",");
    rows.forEach((row, idx) => {
        const p = row.split("|");
        if(p.length < 2) return;
        const li = document.createElement("li");
        li.style.padding = "8px 12px";
        li.style.background = "#ffffff";
        li.style.borderBottom = "1px solid #eee";
        let medal = `${idx + 1}.`;
        if (idx === 0) medal = "🥇";
        else if (idx === 1) medal = "🥈";
        else if (idx === 2) medal = "🥉";
        li.innerHTML = `<strong>${medal} ${p[0]}</strong> <span style="float:right;">${p[1]} pts</span>`;
        tempContainer.appendChild(li);
    });
}

function onFinalLeaderboard(payload) {
    sessionStorage.setItem("finalLeaderboard", payload);
}

function onQuizEnded() {
    const page = window.location.pathname.split("/").pop();
    if (page !== "leaderboard.html") goToLeaderboard();
}

// ==========================================
// LEADERBOARD PAGE 
// ==========================================
function initLeaderboardPage() {
    const data = sessionStorage.getItem("finalLeaderboard");
    if(!data || data === "-") return;

    //Logika Tampilan Khusus Role
    const role = getRole();
    const memeImg = document.getElementById("leaderboard-meme");
    const scoreBox = document.getElementById("score-container");

    if (role === 'host') {
        if(memeImg) memeImg.style.display = 'none';
        if(scoreBox) scoreBox.style.display = 'none';
    } else {
        // Untuk peserta, tampilkan meme acak
        if(memeImg) memeImg.src = `assets/leaderboard/leaderboard${Math.floor(Math.random()*3)+1}.jpg`;
    }

    //Render Leaderboard
    const container = document.getElementById("leaderboard-list");
    const scoreDisplay = document.getElementById("final-score-display");
    if(!container) return;

    container.innerHTML = "";
    const myUsername = getUsername();
    const rows = data.split(",");

    rows.forEach((row, index) => {
        if(!row) return;
        const p = row.split("|");
        if (p.length < 2) return;

        const li = document.createElement("li");
        let medal = `${index + 1}.`;
        if(index === 0) medal = "🥇";
        else if(index === 1) medal = "🥈";
        else if(index === 2) medal = "🥉";

        li.innerText = `${medal} ${p[0]} - ${p[1]} pts`;
        container.appendChild(li);

        // Update skor peserta
        if(p[0] === myUsername && scoreDisplay) {
            scoreDisplay.innerText = p[1];
        }
    });
}
