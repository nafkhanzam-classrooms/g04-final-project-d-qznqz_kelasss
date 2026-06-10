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

// GLOBAL STATE UNTUK WEBRTC
let localStream = null;
let peerConnections = {}; 
const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }] // STUN Server publik gratis milik Google
};

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

    injectBoredButton();
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
        case "PLAYER_ANSWERED": onPlayerAnswered(sender); break; 
        case "LEADERBOARD_DATA": onLeaderboardData(payload); break;
        case "TEMP_LEADERBOARD": onTempLeaderboard(payload); break; 
        case "FINAL_LEADERBOARD": onFinalLeaderboard(payload); break;
        case "QUIZ_ENDED": onQuizEnded(); break;
        // Masukkan case baru ini ke dalam fungsi handleServerMessage asli milikmu:
        case "REACTION_TRIGGERED": showFloatingReaction(sender, payload); break;
        case "PLAYER_HAND_STATE": onPlayerHandState(sender, payload); break;
        case "CLICKER_SUCCESS": onClickerSuccess(payload); break;
        
        // WebRTC Signaling Router
        case "SHARE_STATE_CHANGED": onShareStateChanged(sender, payload); break;
        case "SHARE_TARGETS": onShareTargets(payload); break;
        case "RTC_SIGNAL": onRtcSignal(sender, payload); break;
        case "SHARE_PERMISSION": onSharePermissionChanged(payload); break;
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
    injectBoredButton();
    const page = window.location.pathname.split("/").pop();
    if (page === "index.html" || page === "") goToLobby();
}

function injectBoredButton() {
    if (getRole() !== "participant") return;
    
    // Cari kontainer utama kuis (.card)
    const cardContainer = document.querySelector(".card");
    if (!cardContainer) return;

    // Mencegah duplikasi tombol di dalam card
    if (document.getElementById("bored-toy-btn")) return;

    // Pastikan card memiliki posisi relative agar tombol absolute tidak meleset keluar
    cardContainer.style.position = "relative";

    const toyBtn = document.createElement("button");
    toyBtn.id = "bored-toy-btn";
    toyBtn.innerHTML = "🕹️";
    toyBtn.title = "Pencet aku kalau gabut!";

    const funEmojis = ["🕹️", "👾", "✨", "🔥", "🚀", "🎲", "🎯", "⚡", "🐧"];

    toyBtn.onclick = () => {
        const randomEmoji = funEmojis[Math.floor(Math.random() * funEmojis.length)];
        toyBtn.innerHTML = randomEmoji;

        toyBtn.classList.remove("toy-pop");
        void toyBtn.offsetWidth; // Trik memicu reflow DOM agar animasi reset instan
        toyBtn.classList.add("toy-pop");
    };

    // Masukkan tombol ke dalam card, bukan ke body lagi
    cardContainer.appendChild(toyBtn);
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
        sendPacket("GET_PLAYERS", getPin(), getUsername(), "-");

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
    const display = document.getElementById("max-points-display");
    if(display) display.innerText = `3 × ${timerSeconds}`;
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
    sendPacket("GET_PLAYERS", getPin(), getUsername(), "-");
}

function onPlayerLeft(username) {
    if (getRole() !== "host") return;
    lobbyPlayers = lobbyPlayers.filter(p => p !== username);
    renderPlayerList();
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
    if(lobbyPlayers.length === 0) return alert("Minimal 1 peserta harus bergabung sebelum memulai kuis");
    
    const numQuestions = parseInt(document.getElementById("num-questions")?.value) || 5;
    const timerSeconds = parseInt(document.getElementById("timer-seconds")?.value) || 30;
    
    if(numQuestions < 1) return alert("Jumlah soal minimal 1");
    if(timerSeconds < 5) return alert("Timer minimal 5 detik");
    
    sessionStorage.setItem("numQuestions", numQuestions);
    sessionStorage.setItem("timerSeconds", timerSeconds);
    sendPacket("START_QUIZ", getPin(), getUsername(), `${numQuestions}|${timerSeconds}`);
}

// ==========================================
// QUIZ PAGE
// ==========================================
function onQuizStarted() {
    sessionStorage.setItem("quizStarted", "true");
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
    document.getElementById("participant-temp-leaderboard").style.display = "none";
    document.getElementById("meme-image").style.display = "none";
    document.getElementById("answer-feedback").innerHTML = "";

    if(getRole() === "participant") {
        // PERBAIKAN: Mengganti .style.block menjadi .style.display
        document.getElementById("participant-quiz-space").style.display = "block"; 
    } else {
        document.getElementById("host-quiz-space").style.display = "block";
    }

    const parts = payload.split("|");
    if(parts.length < 6) return; // Proteksi crash jika payload pincang

    currentQuestionIndex = parseInt(parts[0]);
    questionTimestamp = parts.length > 6 ? parseInt(parts[6]) : Date.now();
    
    document.getElementById("question-number").innerText = `Soal #${currentQuestionIndex + 1}`;
    document.getElementById("question-text").innerText = parts[1];
    document.getElementById("btnA").innerText = `▲ ${parts[2]}`;
    document.getElementById("btnB").innerText = `✖ ${parts[3]}`;
    document.getElementById("btnC").innerText = `● ${parts[4]}`;
    document.getElementById("btnD").innerText = `■ ${parts[5]}`;

    if(getRole() === "participant") {
        const timerDisplay = document.getElementById("timer-display");
        if (timerDisplay) timerDisplay.style.display = "block";
        if(timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const timerElement = document.getElementById("timer");
            if (timerElement) {
                timerElement.innerText = ((Date.now() - questionTimestamp) / 1000).toFixed(1);
            }
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
    
    if(timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    const answerTimestamp = Date.now();
    sendPacket("ANSWER", getPin(), getUsername(), `${currentQuestionIndex}|${answer}|${answerTimestamp}`);
}

function onAnswerResult(payload) {
    const parts = payload.split("|");
    const status = parts[0];
    const score = parts[1];
    const streak = parts[2];
    const basePoints = parts.length > 3 ? parseInt(parts[3]) : 0;
    const streakBonus = parts.length > 4 ? parseInt(parts[4]) : 0;
    
    sessionStorage.setItem("myScore", score);
    const feedback = document.getElementById("answer-feedback");
    const meme = document.getElementById("meme-image");
    const timerDisplay = document.getElementById("timer-display");
    
    if(!feedback) return;
    if(timerDisplay) timerDisplay.style.display = "none";
    
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
    // Pastikan menutup screen share sebelum pindah halaman
    if(localStream) stopScreenShare();
    const page = window.location.pathname.split("/").pop();
    if (page !== "leaderboard.html") goToLeaderboard();
}

// ==========================================
// LEADERBOARD PAGE 
// ==========================================
function initLeaderboardPage() {
    const data = sessionStorage.getItem("finalLeaderboard");
    if(!data || data === "-") return;

    const role = getRole();
    const memeImg = document.getElementById("leaderboard-meme");
    const scoreBox = document.getElementById("score-container");

    if (role === 'host') {
        if(memeImg) memeImg.style.display = 'none';
        if(scoreBox) scoreBox.style.display = 'none';
    } else {
        if(memeImg) memeImg.src = `assets/leaderboard/leaderboard${Math.floor(Math.random()*3)+1}.jpg`;
    }

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

        if(p[0] === myUsername && scoreDisplay) {
            scoreDisplay.innerText = p[1];
        }
    });
}

// ==========================================================
// LOGIKA UTAMA WEBRTC SCREEN SHARING (NEW FEATURE)
// ==========================================================

function toggleLocalShare() {
    if (localStream) {
        stopScreenShare();
        updateShareButtonText(false);
    } else {
        startScreenShare();
    }
}

function updateShareButtonText(isSharing) {
    const hostBtn = document.getElementById("host-share-btn");
    const studentBtn = document.getElementById("student-share-btn");
    const text = isSharing ? "Stop Share 🛑" : (getRole() === "host" ? "Share Screen 🖥️" : "Share Screen Saya 🖥️");
    
    if (hostBtn) hostBtn.innerText = text;
    if (studentBtn) studentBtn.innerText = text;
}

async function startScreenShare() {
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        updateShareButtonText(true);

        const container = document.getElementById("screenshare-container");
        const video = document.getElementById("remote-screen-video");
        const label = document.getElementById("screen-sharer-name");
        
        if(container && video && label) {
            container.style.display = "block";
            video.srcObject = localStream;
            video.muted = true;
            label.innerText = `🖥️ Anda sedang mempresentasikan layar`;
        }

        // Kabari server bahwa user ini mulai melakukan presentasi layar
        sendPacket("SHARE_STATE", getPin(), getUsername(), "STARTED");

        // Deteksi tombol bawaan browser "Stop Sharing" jika diklik oleh user
        localStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
            updateShareButtonText(false);
        };
    } catch (err) {
        console.error("Gagal share screen:", err);
        alert("Gagal mengakses antarmuka capture screen device.");
    }
}

function stopScreenShare() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    sendPacket("SHARE_STATE", getPin(), getUsername(), "STOPPED");
    
    const container = document.getElementById("screenshare-container");
    const video = document.getElementById("remote-screen-video");
    if (container) container.style.display = "none";
    if (video) video.srcObject = null;
    
    // Matikan semua instans P2P koneksi
    Object.keys(peerConnections).forEach(key => {
        peerConnections[key].close();
        delete peerConnections[key];
    });
    peerConnections = {};
}

// Jalankan pembuatan RTC Peer Connections untuk setiap target yang diberikan server
async function onShareTargets(payload) {
    if (!payload || payload.trim() === "") return;
    const targets = payload.split(",");
    
    for (const target of targets) {
        await initiateWebRTCConnection(target);
    }
}

async function initiateWebRTCConnection(target) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[target] = pc;
    
    // Inject track dari media layar lokal
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    pc.onicecandidate = event => {
        if (event.candidate) {
            sendPacket("RTC_SIGNAL", getPin(), getUsername(), `ICE|${target}|${JSON.stringify(event.candidate)}`);
        }
    };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendPacket("RTC_SIGNAL", getPin(), getUsername(), `OFFER|${target}|${JSON.stringify(offer)}`);
}

function onShareStateChanged(sender, status) {
    const container = document.getElementById("screenshare-container");
    const video = document.getElementById("remote-screen-video");
    const label = document.getElementById("screen-sharer-name");
    
    if (status === "STARTED") {
        if (sender !== getUsername()) {
            if (container && label) {
                container.style.display = "block";
                label.innerText = `📺 Mengamati Layar dari: ${sender}`;
            }
        }
    } else {
        // STATUS: STOPPED
        if (sender !== getUsername()) {
            if (container) container.style.display = "none";
            if (video) video.srcObject = null;
            
            if (peerConnections[sender]) {
                peerConnections[sender].close();
                delete peerConnections[sender];
            }
        }
    }
}

function onRtcSignal(sender, payload) {
    const parts = payload.split("|", 2);
    const sigType = parts[0];
    const sigData = parts[1];
    
    if (sigType === "OFFER") {
        handleIncomingOffer(sender, sigData);
    } else if (sigType === "ANSWER") {
        handleIncomingAnswer(sender, sigData);
    } else if (sigType === "ICE") {
        handleIncomingIce(sender, sigData);
    }
}

async function handleIncomingOffer(sender, dataJson) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[sender] = pc;
    
    pc.onicecandidate = event => {
        if (event.candidate) {
            sendPacket("RTC_SIGNAL", getPin(), getUsername(), `ICE|${sender}|${JSON.stringify(event.candidate)}`);
        }
    };
    
    // Pasang stream inbound ke elemen video ketika stream terdeteksi
    pc.ontrack = event => {
        const video = document.getElementById("remote-screen-video");
        if (video) {
            video.srcObject = event.streams[0];
        }
    };
    
    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(dataJson)));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendPacket("RTC_SIGNAL", getPin(), getUsername(), `ANSWER|${sender}|${JSON.stringify(answer)}`);
}

async function handleIncomingAnswer(sender, dataJson) {
    const pc = peerConnections[sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(dataJson)));
    }
}

async function handleIncomingIce(sender, dataJson) {
    const pc = peerConnections[sender];
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(dataJson)));
        } catch (e) {
            console.error("Gagal memproses ICE Candidate:", e);
        }
    }
}

// Manajemen Otorisasi Hak Akses Share Screen dari Sisi Host
function handleGrantShare(statusVal) {
    const targetInput = document.getElementById("input-target-share");
    const targetName = targetInput ? targetInput.value.trim() : "";
    if (!targetName) return alert("Masukkan nama mahasiswa target terlebih dahulu.");
    
    sendPacket("ALLOW_SHARE", getPin(), getUsername(), `${targetName}|${statusVal}`);
    alert(`Aksi otorisasi share screen dikirim untuk: ${targetName}`);
    if(targetInput) targetInput.value = ""; 
}

function onSharePermissionChanged(payload) {
    const btn = document.getElementById("student-share-btn");
    if (payload === "ALLOWED") {
        alert("📢 Host memberikan Anda izin akses presentasi layar! Tombol 'Share Screen Saya' sekarang aktif.");
        if (btn) btn.style.display = "block";
    } else if (payload === "DENIED") {
        alert("🛑 Hak akses presentasi layar Anda telah dicabut oleh Host.");
        if (btn) btn.style.display = "none";
        if (localStream) {
            stopScreenShare();
            updateShareButtonText(false);
        }
    }
} // <-- KURUNG KURAWAL INI YANG TADI HILANG UNTUK MENUTUP FUNGSI

// ==========================================================
// 🚀 LOGIKA REACTION, RAISE HAND, & CLICKER RETENTION
// ==========================================================

let isHandRaised = false;

// Inject Style Animasi Khusus secara Dinamis agar tidak mengotori style.css
const rStyle = document.createElement('style');
rStyle.innerHTML = `
    @keyframes floatUp {
        0% { transform: translateY(0) scale(1); opacity: 1; }
        100% { transform: translateY(-220px) scale(1.6); opacity: 0; }
    }
    @keyframes bounceIn {
        0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
        50% { transform: translate(-50%, -50%) scale(1.08); }
        70% { transform: translate(-50%, -50%) scale(0.92); }
        100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    }
    .btn-reaction {
        font-size: 22px; border: none; background: transparent; cursor: pointer; transition: transform 0.1s ease;
    }
    .btn-reaction:hover { transform: scale(1.3); }
    .btn-reaction:active { transform: scale(0.85); }
    .floating-emoji-item {
        position: fixed; bottom: 25%; font-size: 38px; pointer-events: none; z-index: 9999; animation: floatUp 1.4s ease-out forwards;
    }
        /* 🎯 STYLE TOMBOL ANTI-GABUT (Sekarang Mengikuti Elemen Card) */
    #bored-toy-btn {
        position: absolute; /* Diubah dari fixed ke absolute */
        top: 14px;
        right: 14px;
        z-index: 10000;
        font-size: 20px;
        background: #f8fafc;
        border: 2px solid var(--border-color);
        border-radius: 50%;
        width: 44px;
        height: 44px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
        transition: transform 0.1s ease, background-color 0.2s;
    }
    #bored-toy-btn:hover {
        background-color: #f1f5f9;
    }
    #bored-toy-btn:active {
        transform: scale(0.9);
    }
    /* Animasi Pop saat diklik */
    .toy-pop {
        animation: popAnimation 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes popAnimation {
        0% { transform: scale(1); }
        50% { transform: scale(1.25) rotate(15deg); }
        100% { transform: scale(1); }
    }
`;
document.head.appendChild(rStyle);

// Fungsi Kirim Emoji
function sendReaction(emoji) {
    sendPacket("SEND_REACTION", getPin(), getUsername(), emoji);
}

// Menampilkan Emoji Mengapung (Bebas Spam di Mhs) & Mencatat 1x Per Soal (Di Sisi Dosen)
function showFloatingReaction(sender, emoji) {
    
    // 1. EFEK VISUAL MAHASISWA: Tetap muncul berkali-kali setiap diklik agar seru buat mainan
    if (getRole() !== "host") {
        const emojiEl = document.createElement("div");
        emojiEl.className = "floating-emoji-item";
        emojiEl.innerText = emoji;
        
        const randomOffset = Math.floor(Math.random() * 160) - 80;
        emojiEl.style.left = `calc(50% + ${randomOffset}px)`;
        
        document.body.appendChild(emojiEl);
        setTimeout(() => emojiEl.remove(), 1400);
    }

    // 2. LOGIKAL DOSEN (HOST): Hanya mencatat 1x per jenis emoji di setiap nomor soal
    if (getRole() === "host") {
        const feed = document.getElementById("live-activity-list");
        if (feed) {
            // Bersihkan nama dari karakter aneh agar aman dijadikan ID HTML
            const safeSender = sender.replace(/[^a-zA-Z0-9]/g, "_");
            
            // Gabungkan indeks soal, nama, dan emojinya sebagai ID unik
            const reactionId = `react-${currentQuestionIndex}-${safeSender}-${emoji}`;
            
            // FILTER ANTI-SPAM: Jika ID ini sudah ada di feed dosen, langsung stop di sini (tidak dicatat lagi)
            if (document.getElementById(reactionId)) return;

            // Jika belum ada, buat baris baru
            const li = document.createElement("li");
            li.id = reactionId; // Kunci ID-nya di sini
            li.style.padding = "10px 14px";
            li.style.background = "#f0fdf4"; // Latar hijau pastel
            li.style.borderLeft = "4px solid var(--green)";
            li.style.animation = "slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
            li.innerHTML = `✨ <strong>${sender}</strong> memberikan reaksi: <span style="font-size: 18px;">${emoji}</span>`;
            
            feed.prepend(li);
        }
    }
}

// Fungsi Angkat/Turun Tangan Mahasiswa
function toggleRaiseHand() {
    isHandRaised = !isHandRaised;
    const btn = document.getElementById("raise-hand-btn");
    
    if (isHandRaised) {
        if(btn) { btn.innerText = "✋ Turunkan Tangan"; btn.style.background = "var(--accent)"; btn.style.color = "white"; }
        sendPacket("RAISE_HAND", getPin(), getUsername(), "1");
    } else {
        if(btn) { btn.innerText = "✋ Angkat Tangan"; btn.style.background = "#cbd5e1"; btn.style.color = "var(--text-main)"; }
        sendPacket("RAISE_HAND", getPin(), getUsername(), "0");
    }
}

// Amati status tangan mahasiswa di Live Activity Host
function onPlayerHandState(sender, state) {
    const feed = document.getElementById("live-activity-list");
    if (!feed) return;
    
    const li = document.createElement("li");
    li.style.padding = "10px 14px";
    if (state === "1") {
        li.style.background = "#fef3c7";
        li.style.borderLeft = "4px solid var(--accent)";
        li.innerHTML = `✋ <strong>${sender}</strong> sedang mengangkat tangan.`;
    } else {
        li.style.background = "#ffffff";
        li.innerHTML = `🏳️ ${sender} menurunkan tangan.`;
    }
    feed.prepend(li);
}