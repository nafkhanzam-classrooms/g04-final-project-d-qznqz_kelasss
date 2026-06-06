import asyncio
import websockets
import mysql.connector
import logging
import random
import string
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
    cursor.execute("SELECT status,current_question_index FROM rooms WHERE pin=%s", (pin,))
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

def restore_rooms_from_db():
    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT pin, status, current_question_index FROM rooms WHERE status != 'ended'")
    rooms = cursor.fetchall()
    cursor.close()
    db.close()
    for room in rooms:
        active_rooms[room["pin"]] = {
            "status": room["status"],
            "host": None,
            "players": {},
            "current_question_index": room["current_question_index"]
        }
    logging.info(f"{len(rooms)} room dipulihkan dari database")

async def send_question_to_room(pin, index):
    question = get_question(index)
    if not question: return False
    payload = f"{index}|{question['question_text']}|{question['option_a']}|{question['option_b']}|{question['option_c']}|{question['option_d']}"
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
                cursor.execute("INSERT INTO rooms (pin, status, current_question_index) VALUES (%s, 'waiting', 0)", (room_pin,))
                room_id = cursor.lastrowid
                cursor.execute("INSERT INTO players (room_id, username, role, session_token) VALUES (%s, %s, 'host', %s)", (room_id, username, token))
                db.commit()
                cursor.close()
                db.close()

                active_rooms[room_pin] = {"status": "waiting", "host": websocket, "players": {}, "current_question_index": 0}
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
                    if pin not in active_rooms: active_rooms[pin] = {"status": "started", "host": None, "players": {}, "current_question_index": 0}
                    
                    if role == "host": active_rooms[pin]["host"] = websocket
                    else: active_rooms[pin]["players"][username] = websocket

                    await safe_send(websocket, f"RESUME_SUCCESS;{pin};{username};{role}")
                    
                    room_state = get_room_status(pin)
                    if room_state and room_state["status"] == "started":
                        await safe_send(websocket, f"QUIZ_STARTED;{pin};SERVER;-")
                        active_rooms[pin]["current_question_index"] = room_state["current_question_index"]
                        q = get_question(room_state["current_question_index"])
                        if q:
                            pq = f"{room_state['current_question_index']}|{q['question_text']}|{q['option_a']}|{q['option_b']}|{q['option_c']}|{q['option_d']}"
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
                db = get_db()
                cursor = db.cursor()
                cursor.execute("UPDATE rooms SET status='started', current_question_index=0 WHERE pin=%s", (pin,))
                db.commit()
                cursor.close(); db.close()
                
                active_rooms[pin]["status"] = "started"
                active_rooms[pin]["current_question_index"] = 0
                await broadcast_all(pin, f"QUIZ_STARTED;{pin};SERVER;-")
                await send_question_to_room(pin, 0)

            elif action == "ANSWER":
                if client_role != "participant": continue
                q_index, answer = payload.split("|")
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
                        new_streak = player["streak"] + 1 if is_correct else 0
                        new_score = player["score"] + (1000 + (new_streak * 100)) if is_correct else player["score"]

                        cursor.execute("INSERT INTO answers (player_id, question_id, answer, is_correct) VALUES (%s, %s, %s, %s)", (player["id"], question["id"], answer, is_correct))
                        cursor.execute("UPDATE players SET score=%s, streak=%s WHERE id=%s", (new_score, new_streak, player["id"]))
                        db.commit()

                        status_str = "CORRECT" if is_correct else "WRONG"
                        await safe_send(websocket, f"ANSWER_RESULT;{pin};{username};{status_str}|{new_score}|{new_streak}")
                        
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
                
                #Jeda Waktu 5 Detik
                await asyncio.sleep(5)
                
                next_index = room["current_question_index"] + 1
                total_questions = get_total_questions()

                #Cek apakah ini soal terakhir
                if next_index >= total_questions:
                    final_payload = build_final_leaderboard(pin)
                    await broadcast_all(pin, f"FINAL_LEADERBOARD;{pin};SERVER;{final_payload}")
                    await broadcast_all(pin, f"QUIZ_ENDED;{pin};SERVER;-")
                    
                    db = get_db()
                    cursor = db.cursor()
                    cursor.execute("UPDATE rooms SET status='ended' WHERE pin=%s", (pin,))
                    db.commit(); cursor.close(); db.close()
                    room["status"] = "ended"
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
                
                db = get_db()
                cursor = db.cursor()
                cursor.execute("UPDATE rooms SET status='ended' WHERE pin=%s", (pin,))
                db.commit(); cursor.close(); db.close()
                
                if pin in active_rooms:
                    active_rooms[pin]["status"] = "ended"

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