import asyncio
import websockets
import mysql.connector
import logging
import random
import string
import time
from datetime import datetime

# ==========================================================
# KONFIGURASI
# ==========================================================
HOST = "localhost"
PORT = 8765
MAX_ROOMS = 7
MAX_PLAYERS = 10

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s : %(message)s"
)
logging.getLogger("websockets").setLevel(logging.WARNING)

active_rooms = {}

# ==========================================================
# SCORING LOGIC
# ==========================================================
def calculate_points(answer_time_ms: int, is_correct: bool, timer_seconds: int = 30) -> int:
    if not is_correct:
        return 0
    
    base_points = timer_seconds * 3
    time_seconds = answer_time_ms / 1000
    
    if time_seconds <= 3:
        return base_points
    else:
        points = base_points - int(time_seconds - 3)
        return max(0, points)

def calculate_streak_multiplier(streak: int) -> float:
    if streak <= 0:
        return 1.0
    return 1.0 + (streak - 1) * 0.125

def calculate_final_score(base_points: int, streak: int) -> int:
    multiplier = calculate_streak_multiplier(streak)
    final = int(base_points * multiplier)
    return final

# ==========================================================
# DATABASE HELPERS
# ==========================================================
def get_db():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="",
        database="quiz_db"
    )

def generate_pin():
    while True:
        pin = str(random.randint(100000, 999999))
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT id FROM rooms WHERE pin=%s", (pin,))
        exists = cursor.fetchone()
        cursor.close()
        db.close()
        if not exists: return pin

def generate_token(length=32):
    chars = string.ascii_letters + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

def get_room_id(pin):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT id FROM rooms WHERE pin=%s", (pin,))
    row = cursor.fetchone()
    cursor.close()
    db.close()
    return row[0] if row else None

def get_room_status(pin):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT status, current_question_index, num_questions, timer_seconds FROM rooms WHERE pin=%s", (pin,))
    room = cursor.fetchone()
    cursor.close()
    db.close()
    return room

def get_question(index):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT * FROM questions ORDER BY id LIMIT 1 OFFSET %s", (index,))
    question = cursor.fetchone()
    cursor.close()
    db.close()
    return question

def get_total_questions():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT COUNT(*) FROM questions")
    total = cursor.fetchone()[0]
    cursor.close()
    db.close()
    return total

# ==========================================================
# BROADCAST HELPERS
# ==========================================================
async def safe_send(ws, message):
    if ws is None: return
    try:
        await ws.send(message)
    except Exception:
        pass

async def broadcast_all(pin, message):
    if pin not in active_rooms: return
    room = active_rooms[pin]
    await safe_send(room.get("host"), message)
    for ws in room["players"].values():
        await safe_send(ws, message)

def build_leaderboard(pin):
    room_id = get_room_id(pin)
    if not room_id: return ""
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT username, score FROM players WHERE room_id=%s AND role='participant' ORDER BY score DESC", (room_id,))
    players = cursor.fetchall()
    cursor.close()
    db.close()

    payload_parts = []
    for player in players:
        payload_parts.append(f"{player['username']}|{player['score']}|-")
    return ",".join(payload_parts)

def build_final_leaderboard(pin):
    return build_leaderboard(pin)

def delete_room_from_db(pin):
    try:
        room_id = get_room_id(pin)
        if not room_id:
            return
        db = get_db()
        cursor = db.cursor()
        cursor.execute("DELETE FROM answers WHERE player_id IN (SELECT id FROM players WHERE room_id=%s)", (room_id,))
        cursor.execute("DELETE FROM players WHERE room_id=%s", (room_id,))
        cursor.execute("DELETE FROM rooms WHERE id=%s", (room_id,))
        db.commit()
        cursor.close()
        db.close()
        logging.info(f"Room {pin} dan semua data peserta dihapus dari database")
    except Exception as e:
        logging.error(f"Error deleting room {pin}: {e}")

def restore_rooms_from_db():
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT pin, status, current_question_index, num_questions, timer_seconds FROM rooms WHERE status != 'ended'")
    rooms = cursor.fetchall()
    cursor.close()
    db.close()
    for room in rooms:
        active_rooms[room["pin"]] = {
            "status": room["status"],
            "host": None,
            "players": {},
            "current_question_index": room["current_question_index"],
            "num_questions": room["num_questions"],
            "timer_seconds": room["timer_seconds"],
            "question_timestamp": 0
        }
    logging.info(f"{len(rooms)} room dipulihkan dari database")

async def send_question_to_room(pin, index):
    question = get_question(index)
    if not question: return False
    
    question_timestamp = int(time.time() * 1000)
    if pin in active_rooms:
        active_rooms[pin]["question_timestamp"] = question_timestamp
    
    payload = f"{index}|{question['question_text']}|{question['option_a']}|{question['option_b']}|{question['option_c']}|{question['option_d']}|{question_timestamp}"
    await broadcast_all(pin, f"SHOW_QUESTION;{pin};SERVER;{payload}")
    return True

# ==========================================================
# CLIENT HANDLER
# ==========================================================
async def handle_client(websocket):
    client_pin = None
    client_username = None
    client_role = None

    try:
        async for message in websocket:
            parts = message.split(';', 3)
            if len(parts) != 4: continue

            action, pin, username, payload = parts

            if action == "CREATE":
                room_pin = generate_pin()
                token = generate_token()
                db = get_db()
                cursor = db.cursor()
                cursor.execute("INSERT INTO rooms (pin, status, current_question_index, num_questions, timer_seconds) VALUES (%s, 'waiting', 0, 5, 30)", (room_pin,))
                room_id = cursor.lastrowid
                cursor.execute("INSERT INTO players (room_id, username, role, session_token) VALUES (%s, %s, 'host', %s)", (room_id, username, token))
                db.commit()
                cursor.close()
                db.close()

                active_rooms[room_pin] = {"status": "waiting", "host": websocket, "players": {}, "current_question_index": 0, "num_questions": 5, "timer_seconds": 30, "question_timestamp": 0}
                client_pin, client_username, client_role = room_pin, username, "host"

                await safe_send(websocket, f"ROOM_CREATED;{room_pin};{username};{token}")
                logging.info(f"{username} membuat room {room_pin}")

            elif action == "JOIN":
                if pin not in active_rooms:
                    await safe_send(websocket, f"ERROR;{pin};SERVER;Room tidak ditemukan")
                    continue
                
                room_id = get_room_id(pin)
                db = get_db()
                cursor = db.cursor(dictionary=True)
                cursor.execute("SELECT id FROM players WHERE room_id=%s AND username=%s", (room_id, username))
                if cursor.fetchone():
                    await safe_send(websocket, f"ERROR;{pin};SERVER;Username terpakai")
                    cursor.close()
                    db.close()
                    continue

                token = generate_token()
                cursor.execute("INSERT INTO players (room_id, username, role, session_token) VALUES (%s, %s, 'participant', %s)", (room_id, username, token))
                db.commit()
                cursor.close()
                db.close()

                active_rooms[pin]["players"][username] = websocket
                client_pin, client_username, client_role = pin, username, "participant"

                await safe_send(websocket, f"JOIN_SUCCESS;{pin};{username};{token}")
                await safe_send(active_rooms[pin]["host"], f"PLAYER_JOINED;{pin};{username};-")
                logging.info(f"Player {username} bergabung di room {pin}")

            elif action == "RESUME":
                token = payload
                db = get_db()
                cursor = db.cursor(dictionary=True)
                room_id = get_room_id(pin)
                if not room_id: 
                    cursor.close(); db.close(); continue
                    
                cursor.execute("SELECT role, session_token FROM players WHERE room_id=%s AND username=%s", (room_id, username))
                player = cursor.fetchone()
                
                if player and player["session_token"] == token:
                    role = player["role"]
                    cursor.execute("UPDATE players SET is_active=TRUE WHERE room_id=%s AND username=%s", (room_id, username))
                    db.commit()
                    cursor.close()
                    db.close()

                    client_pin, client_username, client_role = pin, username, role
                    if pin not in active_rooms: active_rooms[pin] = {"status": "started", "host": None, "players": {}, "current_question_index": 0, "num_questions": 5, "timer_seconds": 30, "question_timestamp": 0}
                    
                    if role == "host": active_rooms[pin]["host"] = websocket
                    else: active_rooms[pin]["players"][username] = websocket

                    await safe_send(websocket, f"RESUME_SUCCESS;{pin};{username};{role}")
                    
                    room_state = get_room_status(pin)
                    if room_state and room_state["status"] == "started":
                        await safe_send(websocket, f"QUIZ_STARTED;{pin};SERVER;-")
                        active_rooms[pin]["current_question_index"] = room_state["current_question_index"]
                        active_rooms[pin]["num_questions"] = room_state.get("num_questions", 5)
                        active_rooms[pin]["timer_seconds"] = room_state.get("timer_seconds", 30)
                        active_rooms[pin]["question_timestamp"] = int(time.time() * 1000)
                        q = get_question(room_state["current_question_index"])
                        if q:
                            pq = f"{room_state['current_question_index']}|{q['question_text']}|{q['option_a']}|{q['option_b']}|{q['option_c']}|{q['option_d']}|{active_rooms[pin]['question_timestamp']}"
                            await safe_send(websocket, f"SHOW_QUESTION;{pin};SERVER;{pq}")
                else:
                    cursor.close(); db.close()

            elif action == "GET_PLAYERS":
                room_id = get_room_id(pin)
                db = get_db()
                cursor = db.cursor(dictionary=True)
                cursor.execute("SELECT username FROM players WHERE room_id=%s AND role='participant' AND is_active=TRUE", (room_id,))
                players = [p["username"] for p in cursor.fetchall()]
                await safe_send(websocket, f"PLAYER_LIST;{pin};SERVER;{','.join(players)}")
                cursor.close(); db.close()

            elif action == "START_QUIZ":
                if client_role != "host": continue
                settings = payload.split("|") if payload != "-" else []
                num_questions = int(settings[0]) if len(settings) > 0 else 5
                timer_seconds = int(settings[1]) if len(settings) > 1 else 30
                
                db = get_db()
                cursor = db.cursor()
                cursor.execute("UPDATE rooms SET status='started', current_question_index=0, num_questions=%s, timer_seconds=%s WHERE pin=%s", 
                              (num_questions, timer_seconds, pin))
                db.commit()
                cursor.close(); db.close()
                
                active_rooms[pin]["status"] = "started"
                active_rooms[pin]["current_question_index"] = 0
                active_rooms[pin]["num_questions"] = num_questions
                active_rooms[pin]["timer_seconds"] = timer_seconds
                active_rooms[pin]["question_timestamp"] = int(time.time() * 1000)
                
                await broadcast_all(pin, f"QUIZ_STARTED;{pin};SERVER;-")
                await send_question_to_room(pin, 0)
                logging.info(f"{username} memulai quiz di room {pin}")

            elif action == "ANSWER":
                if client_role != "participant": continue
                q_index, answer, answer_timestamp = payload.split("|")
                question = get_question(int(q_index))
                
                room_id = get_room_id(pin)
                db = get_db()
                cursor = db.cursor(dictionary=True)
                cursor.execute("SELECT id, score, streak FROM players WHERE room_id=%s AND username=%s", (room_id, username))
                player = cursor.fetchone()
                
                if player and question:
                    cursor.execute("SELECT id FROM answers WHERE player_id=%s AND question_id=%s", (player["id"], question["id"]))
                    if not cursor.fetchone():
                        is_correct = (answer == question["correct_answer"])
                        question_ts = active_rooms.get(pin, {}).get("question_timestamp", 0)
                        answer_ts = int(answer_timestamp)
                        answer_time_ms = max(0, answer_ts - question_ts)
                        timer_seconds = active_rooms.get(pin, {}).get("timer_seconds", 30)
                        
                        base_points = calculate_points(answer_time_ms, is_correct, timer_seconds)
                        new_streak = player["streak"] + 1 if is_correct else 0
                        streak_bonus = calculate_final_score(base_points, new_streak)
                        new_score = player["score"] + streak_bonus
                        
                        cursor.execute(
                            "INSERT INTO answers (player_id, question_id, answer, is_correct, answer_time_ms, points_earned, streak_at_answer) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                            (player["id"], question["id"], answer, is_correct, answer_time_ms, streak_bonus, player["streak"] + 1 if is_correct else 0)
                        )
                        cursor.execute("UPDATE players SET score=%s, streak=%s WHERE id=%s", (new_score, new_streak, player["id"]))
                        db.commit()

                        status_str = "CORRECT" if is_correct else "WRONG"
                        streak_multiplier = calculate_streak_multiplier(new_streak) if is_correct else calculate_streak_multiplier(0)
                        await safe_send(websocket, f"ANSWER_RESULT;{pin};{username};{status_str}|{new_score}|{new_streak}|{base_points}|{streak_bonus}|{answer_time_ms}|{streak_multiplier:.3f}")
                        
                        room = active_rooms.get(pin)
                        if room: await safe_send(room["host"], f"PLAYER_ANSWERED;{pin};{username};-")
                        
                        leaderboard_payload = build_leaderboard(pin)
                        await broadcast_all(pin, f"LEADERBOARD_DATA;{pin};SERVER;{leaderboard_payload}")

                cursor.close(); db.close()

            elif action == "NEXT_QUESTION":
                if client_role != "host": continue
                room = active_rooms[pin]
                room_id = get_room_id(pin)
                current_idx = room["current_question_index"]
                current_q = get_question(current_idx)
                
                if room_id and current_q:
                    db = get_db()
                    cursor = db.cursor()
                    cursor.execute("SELECT username FROM players WHERE room_id = %s AND role = 'participant' AND id NOT IN (SELECT player_id FROM answers WHERE question_id = %s)", (room_id, current_q["id"]))
                    players_missed = cursor.fetchall()
                    for row in players_missed:
                        p_username = row[0]
                        logging.info(f"Streak di-reset untuk player {p_username} yang melewatkan pertanyaan {current_idx} di room {pin}")

                    cursor.execute("UPDATE players SET streak = 0 WHERE room_id = %s AND role = 'participant' AND id NOT IN (SELECT player_id FROM answers WHERE question_id = %s)", (room_id, current_q["id"]))
                    db.commit()
                    cursor.close(); db.close()

                leaderboard_payload = build_leaderboard(pin)
                await broadcast_all(pin, f"TEMP_LEADERBOARD;{pin};SERVER;{leaderboard_payload}")
                await asyncio.sleep(5)
                
                next_index = room["current_question_index"] + 1
                num_questions = room.get("num_questions", 5)

                if next_index >= num_questions:
                    final_payload = build_final_leaderboard(pin)
                    await broadcast_all(pin, f"FINAL_LEADERBOARD;{pin};SERVER;{final_payload}")
                    await broadcast_all(pin, f"QUIZ_ENDED;{pin};SERVER;-")
                    delete_room_from_db(pin)
                    room["status"] = "ended"
                    if pin in active_rooms: del active_rooms[pin]
                    continue

                room["current_question_index"] = next_index
                db = get_db()
                cursor = db.cursor()
                cursor.execute("UPDATE rooms SET current_question_index=%s WHERE pin=%s", (next_index, pin))
                db.commit(); cursor.close(); db.close()
                await send_question_to_room(pin, next_index)

            elif action == "END_QUIZ":
                if client_role != "host": continue
                final_payload = build_final_leaderboard(pin)
                await broadcast_all(pin, f"FINAL_LEADERBOARD;{pin};SERVER;{final_payload}")
                await broadcast_all(pin, f"QUIZ_ENDED;{pin};SERVER;-")
                delete_room_from_db(pin)
                if pin in active_rooms:
                    active_rooms[pin]["status"] = "ended"
                    del active_rooms[pin]

            elif action == "DELETE_ROOM":
                if client_role != "host": continue
                if pin in active_rooms:
                    room = active_rooms[pin]
                    for player_socket in list(room["players"].values()):
                        await safe_send(player_socket, f"ROOM_DELETED;{pin};SERVER;Host left the room")
                delete_room_from_db(pin)
                if pin in active_rooms: del active_rooms[pin]

            elif action == "LEAVE":
                if client_role != "participant": continue
                room_id = get_room_id(pin)
                if room_id:
                    db = get_db()
                    cursor = db.cursor()
                    cursor.execute("DELETE FROM players WHERE room_id=%s AND username=%s", (room_id, username))
                    db.commit(); cursor.close(); db.close()
                
                if pin in active_rooms:
                    room = active_rooms[pin]
                    if username in room["players"]: del room["players"][username]
                    if room["host"]: await safe_send(room["host"], f"PLAYER_LEFT;{pin};{username};-")

            elif action == "PING":
                room_id = get_room_id(pin)
                if room_id:
                    db = get_db()
                    cursor = db.cursor()
                    cursor.execute("UPDATE players SET is_active=TRUE WHERE room_id=%s AND username=%s", (room_id, username))
                    db.commit(); cursor.close(); db.close()

            # ==========================================================
            # ADDITIONAL ACTION: SCREEN SHARING & WEBRTC SIGNALING
            # ==========================================================
            elif action == "SHARE_STATE":
                status = payload  # "STARTED" atau "STOPPED"
                room = active_rooms.get(pin)
                if room:
                    # Distribusikan status perubahan share screen ke semua user
                    await broadcast_all(pin, f"SHARE_STATE_CHANGED;{pin};{username};{status}")
                    
                    # Jika baru dimulai, berikan target list ke pengirim agar bisa melakukan P2P handshake
                    if status == "STARTED":
                        targets = []
                        if client_role == "participant" and room["host"]:
                            targets.append("HOST")
                        for p_name in room["players"].keys():
                            if p_name != username:
                                targets.append(p_name)
                        await safe_send(websocket, f"SHARE_TARGETS;{pin};SERVER;{','.join(targets)}")

            elif action == "ALLOW_SHARE":
                if client_role != "host": continue
                target_student, status_val = payload.split("|")  # status_val: "1"=Izinkan, "0"=Cabut
                room = active_rooms.get(pin)
                if room and target_student in room["players"]:
                    perm_str = "ALLOWED" if status_val == "1" else "DENIED"
                    await safe_send(room["players"][target_student], f"SHARE_PERMISSION;{pin};SERVER;{perm_str}")

            elif action == "RTC_SIGNAL":
                # Router Sinyal WebRTC (Format Payload: sig_type|target_user|sig_data)
                sig_type, target_user, sig_data = payload.split("|", 2)
                room = active_rooms.get(pin)
                if room:
                    out_msg = f"RTC_SIGNAL;{pin};{username};{sig_type}|{sig_data}"
                    if target_user == "HOST":
                        if room["host"]: await safe_send(room["host"], out_msg)
                    elif target_user in room["players"]:
                        await safe_send(room["players"][target_user], out_msg)
            elif action == "SEND_REACTION":
                # Meneruskan emoji ke seluruh pasang mata di room (termasuk Host)
                await broadcast_all(pin, f"REACTION_TRIGGERED;{pin};{username};{payload}")

            elif action == "RAISE_HAND":
                # Meneruskan status angkat tangan ("1"=naik, "0"=turun)
                await broadcast_all(pin, f"PLAYER_HAND_STATE;{pin};{username};{payload}")

            elif action == "CLICKER_HIT":
                if client_role != "participant": continue
                room_id = get_room_id(pin)
                db = get_db()
                cursor = db.cursor(dictionary=True)
                cursor.execute("SELECT id, score FROM players WHERE room_id=%s AND username=%s", (room_id, username))
                player = cursor.fetchone()
                
                if player:
                    # Memberikan bonus +5 poin instan karena berhasil fokus
                    new_score = player["score"] + 5
                    cursor.execute("UPDATE players SET score=%s WHERE id=%s", (new_score, player["id"]))
                    db.commit()
                    
                    # Kirim konfirmasi skor baru ke user dan broadcast pembaruan leaderboard
                    await safe_send(websocket, f"CLICKER_SUCCESS;{pin};SERVER;{new_score}")
                    leaderboard_payload = build_leaderboard(pin)
                    await broadcast_all(pin, f"LEADERBOARD_DATA;{pin};SERVER;{leaderboard_payload}")
                    
                cursor.close(); db.close()
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if client_pin and client_username:
            room_id = get_room_id(client_pin)
            if room_id:
                db = get_db()
                cursor = db.cursor()
                cursor.execute("UPDATE players SET is_active=FALSE WHERE room_id=%s AND username=%s", (room_id, client_username))
                db.commit(); cursor.close(); db.close()
            if client_pin in active_rooms:
                room = active_rooms[client_pin]
                if client_role == "participant" and client_username in room["players"]:
                    del room["players"][client_username]
                    asyncio.create_task(safe_send(room["host"], f"PLAYER_LEFT;{client_pin};{client_username};-"))
                elif client_role == "host":
                    room["host"] = None

async def timeout_cleaner():
    while True:
        try:
            db = get_db()
            cursor = db.cursor()
            cursor.execute("UPDATE players SET is_active=FALSE WHERE TIMESTAMPDIFF(SECOND, last_ping, NOW()) > 90")
            db.commit(); cursor.close(); db.close()
        except: pass
        await asyncio.sleep(60)

async def main():
    restore_rooms_from_db()
    asyncio.create_task(timeout_cleaner())
    async with websockets.serve(handle_client, HOST, PORT):
        logging.info("🚀 Server Quiz berjalan di ws://localhost:8765")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())