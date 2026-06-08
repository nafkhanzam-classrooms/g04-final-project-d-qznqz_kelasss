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

active_rooms = {}

# ==========================================================
# SCORING LOGIC
# ==========================================================
def calculate_points(answer_time_ms: int, is_correct: bool, timer_seconds: int = 30) -> int:
    """
    Calculate points based on answer time and timer setting.
    - Base: 3 × timer_seconds (e.g., 30 sec × 3 = 90 max points)
    - First 3 seconds: full base points
    - After 3 seconds: base_points - (time_ms - 3000) / 1000 points
    """
    if not is_correct:
        return 0
    
    base_points = timer_seconds * 3
    time_seconds = answer_time_ms / 1000
    
    if time_seconds <= 3:
        return base_points
    else:
        # -1 point per second after 3 seconds
        points = base_points - int(time_seconds - 3)
        return max(0, points)

def calculate_streak_multiplier(streak: int) -> float:
    """
    Calculate streak multiplier.
    1st streak: x1, 2nd: x1.125, 3rd: x1.25, etc.
    Formula: 1.0 + (streak - 1) * 0.125
    """
    if streak <= 0:
        return 1.0
    return 1.0 + (streak - 1) * 0.125

def calculate_final_score(base_points: int, streak: int) -> int:
    """Calculate final score with streak multiplier"""
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
    except Exception as e:
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
    """Delete room and all associated data from database"""
    try:
        room_id = get_room_id(pin)
        if not room_id:
            return
        
        db = get_db()
        cursor = db.cursor()
        
        # Delete answers (cascade will handle via foreign key)
        cursor.execute("DELETE FROM answers WHERE player_id IN (SELECT id FROM players WHERE room_id=%s)", (room_id,))
        
        # Delete players (cascade will be handled)
        cursor.execute("DELETE FROM players WHERE room_id=%s", (room_id,))
        
        # Delete room
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
            "question_timestamp": 0  # Track when question was sent
        }
    logging.info(f"{len(rooms)} room dipulihkan dari database")

async def send_question_to_room(pin, index):
    question = get_question(index)
    if not question: return False
    
    # Track question timestamp
    question_timestamp = int(time.time() * 1000)  # milliseconds
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
                logging.info(f"Room {room_pin} dibuat")

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
                
                # Parse settings from payload
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
                        
                        # Calculate answer time in milliseconds
                        question_ts = active_rooms.get(pin, {}).get("question_timestamp", 0)
                        answer_ts = int(answer_timestamp)
                        answer_time_ms = answer_ts - question_ts
                        answer_time_ms = max(0, answer_time_ms)  # Ensure non-negative
                        
                        # Get timer setting from room
                        timer_seconds = active_rooms.get(pin, {}).get("timer_seconds", 30)
                        
                        # Calculate base points with timer setting
                        base_points = calculate_points(answer_time_ms, is_correct, timer_seconds)
                        
                        # Update streak
                        new_streak = player["streak"] + 1 if is_correct else 0
                        
                        # Calculate final score with streak multiplier
                        streak_bonus = calculate_final_score(base_points, new_streak)
                        new_score = player["score"] + streak_bonus
                        
                        # Save to database
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
                        
                        # Update Leaderboard Sementara di Host 
                        leaderboard_payload = build_leaderboard(pin)
                        await broadcast_all(pin, f"LEADERBOARD_DATA;{pin};SERVER;{leaderboard_payload}")

                cursor.close(); db.close()

            elif action == "NEXT_QUESTION":
                if client_role != "host": continue
                room = active_rooms[pin]
                
                #Trigger Leaderboard Sementara di sisi Peserta
                leaderboard_payload = build_leaderboard(pin)
                await broadcast_all(pin, f"TEMP_LEADERBOARD;{pin};SERVER;{leaderboard_payload}")
                await asyncio.sleep(5)
                
                next_index = room["current_question_index"] + 1
                num_questions = room.get("num_questions", 5)

                #Cek apakah ini soal terakhir (based on num_questions setting)
                if next_index >= num_questions:
                    final_payload = build_final_leaderboard(pin)
                    await broadcast_all(pin, f"FINAL_LEADERBOARD;{pin};SERVER;{final_payload}")
                    await broadcast_all(pin, f"QUIZ_ENDED;{pin};SERVER;-")
                    
                    # Cleanup: Delete room and all players from database
                    delete_room_from_db(pin)
                    room["status"] = "ended"
                    
                    # Remove from active rooms
                    if pin in active_rooms:
                        del active_rooms[pin]
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
                
                # Cleanup: Delete room and all players from database
                delete_room_from_db(pin)
                
                if pin in active_rooms:
                    active_rooms[pin]["status"] = "ended"
                    del active_rooms[pin]

            elif action == "DELETE_ROOM":
                # Host wants to leave and delete the room
                if client_role != "host": continue
                
                # Notify all players that room is deleted
                if pin in active_rooms:
                    room = active_rooms[pin]
                    for player_name, player_socket in list(room["players"].items()):
                        await safe_send(player_socket, f"ROOM_DELETED;{pin};SERVER;Host left the room")
                
                # Delete room from database
                delete_room_from_db(pin)
                
                # Clean up active rooms
                if pin in active_rooms:
                    del active_rooms[pin]
                logging.info(f"Room {pin} deleted by host")

            elif action == "LEAVE":
                # Participant wants to leave the room
                if client_role != "participant": continue
                
                room_id = get_room_id(pin)
                if room_id:
                    db = get_db()
                    cursor = db.cursor()
                    cursor.execute("DELETE FROM players WHERE room_id=%s AND username=%s", (room_id, username))
                    db.commit()
                    cursor.close()
                    db.close()
                
                # Remove from active room and notify host
                if pin in active_rooms:
                    room = active_rooms[pin]
                    if username in room["players"]:
                        del room["players"][username]
                    if room["host"]:
                        await safe_send(room["host"], f"PLAYER_LEFT;{pin};{username};-")
                logging.info(f"Player {username} left room {pin}")

            elif action == "PING":
                room_id = get_room_id(pin)
                if room_id:
                    db = get_db()
                    cursor = db.cursor()
                    cursor.execute("UPDATE players SET is_active=TRUE WHERE room_id=%s AND username=%s", (room_id, username))
                    db.commit(); cursor.close(); db.close()

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
            db.commit()
            cursor.close()
            db.close()
        except: pass
        await asyncio.sleep(60)

async def main():
    restore_rooms_from_db()
    asyncio.create_task(timeout_cleaner())
    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
