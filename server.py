import asyncio
import websockets
import mysql.connector
import logging

# Konfigurasi Log agar mudah di-debug
logging.basicConfig(level=logging.INFO)

# Batasan untuk jumlah room dan pemain per room
MAX_ROOMS = 7
MAX_PLAYERS = 10

# Menyimpan status koneksi aktif di memori (RAM)
# Format: { "123456": { "host": websocket, "players": { "Budi": websocket } } }
active_rooms = {}

# Koneksi ke Database XAMPP
def get_db():
    return mysql.connector.connect(
        host="localhost",
        user="root",
        password="",
        database="quiz_db"
    )

async def handle_client(websocket):
    # Menyimpan identitas client ini untuk keperluan disconnect
    client_pin = None
    client_username = None
    client_role = None

    try:
        async for message in websocket:
            logging.info(f"Paket masuk: {message}")
            
            # ----------------------------------------------------
            # PENANGANAN MALFORMED PACKET & PROTOKOL KUSTOM
            # Format Paket: ACTION;PIN;USERNAME;PAYLOAD
            # Contoh: JOIN;123456;Budi;-
            # ----------------------------------------------------
            parts = message.split(';', 3)
            if len(parts) != 4:
                await websocket.send("ERROR;-;-;Malformed packet! Format harus ACTION;PIN;USERNAME;PAYLOAD")
                continue
            
            action, pin, username, payload = parts

            # ----------------------------------------------------
            # LOGIKA CREATE CLASS (HOST)
            # ----------------------------------------------------
            if action == "CREATE":
                if len(active_rooms) >= MAX_ROOMS:
                    await websocket.send("ERROR;-;-;Server penuh! Maksimal 7 room aktif.")
                    continue
                
                db = get_db()
                cursor = db.cursor()
                
                # Simpan ke Database
                try:
                    cursor.execute("INSERT INTO rooms (pin, status) VALUES (%s, 'waiting')", (pin,))
                    room_id = cursor.lastrowid
                    cursor.execute("INSERT INTO players (room_id, username, role) VALUES (%s, %s, 'host')", (room_id, username))
                    db.commit()
                except Exception as e:
                    await websocket.send(f"ERROR;{pin};{username};Gagal membuat room di DB.")
                    continue
                finally:
                    cursor.close()
                    db.close()

                # Buat room di memori
                active_rooms[pin] = {"host": websocket, "players": {}, "previous_ranks": []}
                client_pin, client_username, client_role = pin, username, 'host'

                await websocket.send(f"SUCCESS;{pin};{username};Room berhasil dibuat")
                logging.info(f"Room {pin} dibuat oleh {username}")

            # ----------------------------------------------------
            # LOGIKA RECONNECT HOST
            # ----------------------------------------------------
            elif action == "RECONNECT_HOST":
                if pin in active_rooms:
                    active_rooms[pin]["host"] = websocket
                    client_pin, client_username, client_role = pin, username, 'host'
                    await websocket.send(f"SUCCESS;{pin};{username};Host terhubung kembali")
                    logging.info(f"Host {username} merefresh koneksi di room {pin}")
                continue

            # ----------------------------------------------------
            # LOGIKA JOIN CLASS (PESERTA)
            # ----------------------------------------------------
            elif action == "JOIN":
                if pin not in active_rooms:
                    await websocket.send(f"ERROR;{pin};{username};Room PIN tidak ditemukan atau belum aktif.")
                    continue
                
                room_data = active_rooms[pin]
                
                # Cek jika user sudah online aktif di websocket lain (Mencegah duplicate login asli)
                if username in room_data["players"] and room_data["players"][username] != websocket:
                    await websocket.send(f"ERROR;{pin};{username};Username sudah digunakan dan sedang aktif!")
                    continue

                db = get_db()
                cursor = db.cursor()
                
                try:
                    # Ambil ID Room dari PIN
                    cursor.execute("SELECT id FROM rooms WHERE pin = %s", (pin,))
                    room_row = cursor.fetchone()
                    if not room_row:
                        await websocket.send(f"ERROR;{pin};{username};Room tidak terdaftar di database.")
                        continue
                    room_id = room_row[0]
                    
                    # Cek apakah nama peserta sudah terdaftar di room ini
                    cursor.execute("SELECT id FROM players WHERE room_id = %s AND username = %s AND role = 'participant'", (room_id, username))
                    player_exists = cursor.fetchone()
                    
                    if player_exists:
                        # Jika sudah terdaftar, perbarui koneksi websocket di memori tanpa buat entri baru di DB
                        room_data["players"][username] = websocket
                        client_pin, client_username, client_role = pin, username, 'participant'
                        cursor.close()
                        db.close()
                        
                        # Kirim payload spesifik agar frontend tidak memantulkan peserta kembali ke lobi
                        await websocket.send(f"SUCCESS;{pin};{username};Berhasil terhubung kembali")
                        logging.info(f"Peserta {username} menyambung ulang ke room {pin}")
                        continue # Penting: Hentikan eksekusi di sini agar tidak lanjut mengirim pesan "Berhasil bergabung"
                        
                    # ---- Jika benar-benar pemain baru mendaftar pertama kali ----
                    if len(room_data["players"]) >= MAX_PLAYERS:
                        await websocket.send(f"ERROR;{pin};{username};Room penuh! Maksimal 10 peserta.")
                        continue
                        
                    # Simpan ke Database hanya jika belum ada
                    cursor.execute("INSERT INTO players (room_id, username, role) VALUES (%s, %s, 'participant')", (room_id, username))
                    db.commit()
                    
                except Exception as e:
                    logging.error(f"Error Database pada aksi JOIN: {e}")
                    await websocket.send(f"ERROR;{pin};{username};Gagal memproses pendaftaran ke database.")
                    continue
                finally:
                    # Pastikan penutupan kursor dilakukan dengan aman jika db masih terbuka
                    if db.is_connected():
                        cursor.close()
                        db.close()

                # Daftarkan / Perbarui objek koneksi websocket yang aktif di memori RAM server
                room_data["players"][username] = websocket
                client_pin, client_username, client_role = pin, username, 'participant'
                
                # Kirim sukses ke client agar client tahu ia terhubung dengan aman
                await websocket.send(f"SUCCESS;{pin};{username};Berhasil bergabung")
                
                # Beritahu Host untuk memperbarui tampilan lobi secara real-time
                host_ws = room_data["host"]
                await host_ws.send(f"PLAYER_JOINED;{pin};{username};-")
                logging.info(f"Peserta {username} aman tergabung di room {pin}")

            # ----------------------------------------------------
            # START QUIZ (Host memulai kuis)
            # ----------------------------------------------------
            elif action == "START_QUIZ":
                if client_role != 'host':
                    continue
                
                # Update status room di DB
                db = get_db()
                cursor = db.cursor()
                cursor.execute("UPDATE rooms SET status = 'started', current_question_index = 0 WHERE pin = %s", (pin,))
                db.commit()
                cursor.close()
                db.close()

                # Broadcast ke semua peserta di room untuk pindah ke halaman kuis
                room_data = active_rooms[pin]
                for p_username, p_ws in room_data["players"].items():
                    asyncio.create_task(p_ws.send(f"QUIZ_STARTED;{pin};HOST;-"))
                
                await websocket.send(f"SUCCESS;{pin};{username};Kuis dimulai")
                logging.info(f"Kuis {pin} dimulai!")

            # ----------------------------------------------------
            # SLIDE CONTROL (Otomatis Leaderboard -> Jeda -> Next Slide)
            # ----------------------------------------------------
            elif action == "NEXT_SLIDE":
                if client_role != 'host':
                    continue
                
                question_index = int(payload)
                room_data = active_rooms[pin]
                
                # --- FASE 1: BROADCAST LEADERBOARD SEMENTARA DULU ---
                db = get_db()
                cursor = db.cursor(dictionary=True)
                cursor.execute("SELECT id FROM rooms WHERE pin = %s", (pin,))
                room = cursor.fetchone()
                
                if room:
                    room_id = room['id']
                    # Hitung peringkat saat ini
                    cursor.execute("SELECT username, score FROM players WHERE room_id = %s AND role = 'participant' ORDER BY score DESC", (room_id,))
                    players = cursor.fetchall()

                    current_ranks = [p['username'] for p in players]
                    prev_ranks = room_data.get("previous_ranks", [])
                    payload_parts = []

                    for index, p in enumerate(players):
                        uname = p['username']
                        score = p['score']
                        change = "SAME"
                        
                        if prev_ranks and uname in prev_ranks:
                            prev_index = prev_ranks.index(uname)
                            if index < prev_index: change = f"UP_{prev_index - index}"
                            elif index > prev_index: change = f"DOWN_{index - prev_index}"

                        payload_parts.append(f"{uname}|{score}|{change}")

                    room_data["previous_ranks"] = current_ranks
                    leaderboard_payload = ",".join(payload_parts)

                    # Tampilkan layar biru leaderboard ke semua orang
                    for p_ws in room_data["players"].values():
                        asyncio.create_task(p_ws.send(f"LEADERBOARD_DATA;{pin};SERVER;{leaderboard_payload}"))
                    asyncio.create_task(websocket.send(f"LEADERBOARD_DATA;{pin};SERVER;{leaderboard_payload}"))
                
                # --- FASE 2: SERVER JEDA OTOMATIS 5 DETIK ---
                # Selama 5 detik ini, client melihat layar leaderboard sementara
                await asyncio.sleep(5)

                # --- FASE 3: BROADCAST SOAL BERIKUTNYA ---
                # Update database untuk index soal baru
                cursor.execute("UPDATE rooms SET current_question_index = %s WHERE pin = %s", (question_index, pin))
                cursor.execute("SELECT question_text FROM questions LIMIT %s, 1", (question_index,))
                result = cursor.fetchone()
                db.commit()
                cursor.close()
                db.close()

                if result:
                    question_text = result['question_text'] if isinstance(result, dict) else result[0]
                    for p_ws in room_data["players"].values():
                        asyncio.create_task(p_ws.send(f"SHOW_SLIDE;{pin};HOST;{question_index}|{question_text}"))
                    await websocket.send(f"SHOW_SLIDE;{pin};HOST;{question_index}|{question_text}")
                else:
                    for p_ws in room_data["players"].values():
                        asyncio.create_task(p_ws.send(f"END_QUIZ;{pin};HOST;Pertanyaan habis"))
                    await websocket.send(f"END_QUIZ;{pin};HOST;Pertanyaan habis")

            # ----------------------------------------------------
            # CALCULATE SCORE & GAMIFIKASI (Client Menjawab)
            # ----------------------------------------------------
            elif action == "ANSWER":
                if client_role != 'participant':
                    continue
                
                # Payload format: index_soal|jawaban_klien (contoh: 0|A)
                q_index, ans = payload.split('|')
                
                # 🌟 PENGAMAN: Jika indeks soal 'null' atau bukan angka, batalkan proses agar server tidak crash
                if q_index == "null" or not q_index.isdigit():
                    await websocket.send(f"ERROR;{pin};SERVER;Indeks soal tidak valid.")
                    continue

                db = get_db()
                cursor = db.cursor(dictionary=True)
                
                # Ambil jawaban benar dari DB
                cursor.execute("SELECT correct_answer FROM questions LIMIT %s, 1", (int(q_index),))
                q_data = cursor.fetchone()
                
                # Ambil data player saat ini (untuk cek streak dan skor lama)
                cursor.execute("SELECT score, streak FROM players WHERE room_id = (SELECT id FROM rooms WHERE pin=%s) AND username=%s", (pin, username))
                p_data = cursor.fetchone()

                if q_data and p_data:
                    correct_ans = q_data['correct_answer']
                    current_score = p_data['score']
                    current_streak = p_data['streak']

                    if ans == correct_ans:
                        # LOGIKA GAMIFIKASI: Skor dasar + (Bonus Streak * 100)
                        current_streak += 1
                        gained_score = 1000 + (current_streak * 100)
                        new_score = current_score + gained_score
                        result_status = "CORRECT"
                    else:
                        current_streak = 0 # Streak putus
                        new_score = current_score
                        gained_score = 0
                        result_status = "WRONG"

                    # Simpan skor baru ke DB
                    cursor.execute("""
                        UPDATE players 
                        SET score = %s, streak = %s 
                        WHERE room_id = (SELECT id FROM rooms WHERE pin = %s) 
                        AND username = %s
                    """, (new_score, current_streak, pin, username))
                    db.commit()

                    # Kirim umpan balik (feedback) ke peserta untuk men-trigger Meme di Frontend
                    await websocket.send(f"ANSWER_RESULT;{pin};{username};{result_status}|{new_score}|{current_streak}")
                    
                    # Update Host (Live Leaderboard / Jawaban Masuk)
                    host_ws = active_rooms[pin]["host"]
                    asyncio.create_task(host_ws.send(f"PLAYER_ANSWERED;{pin};{username};{new_score}"))

                cursor.close()
                db.close()

            # ----------------------------------------------------
            # GET LEADERBOARD (Mengambil Peringkat)
            # ----------------------------------------------------
            elif action == "GET_LEADERBOARD":
                db = get_db()
                cursor = db.cursor(dictionary=True)
                
                cursor.execute("SELECT id FROM rooms WHERE pin = %s", (pin,))
                room = cursor.fetchone()
                
                if room:
                    room_id = room['id']
                    # Ambil semua skor peserta, urutkan dari yang tertinggi
                    cursor.execute(
                        "SELECT username, score FROM players "
                        "WHERE room_id = %s AND role = 'participant' "
                        "ORDER BY score DESC", (room_id,)
                    )
                    players = cursor.fetchall()

                    # List untuk menyimpan urutan nama kuis saat ini
                    current_ranks = [p['username'] for p in players]
                    prev_ranks = active_rooms[pin]["previous_ranks"]

                    payload_parts = []
                    for index, p in enumerate(players):
                        uname = p['username']
                        score = p['score']
                        change = "SAME" # Default jika tetap atau soal pertama
                        
                        # Hitung Naik/Turun Peringkat dibanding soal sebelumnya
                        if prev_ranks and uname in prev_ranks:
                            prev_index = prev_ranks.index(uname)
                            if index < prev_index: # Indeks lebih kecil berarti peringkat NAIK
                                change = f"UP_{prev_index - index}"
                            elif index > prev_index: # Indeks lebih besar berarti peringkat TURUN
                                change = f"DOWN_{index - prev_index}"

                        payload_parts.append(f"{uname}|{score}|{change}")

                    # Simpan urutan saat ini ke memori untuk perbandingan di soal berikutnya
                    active_rooms[pin]["previous_ranks"] = current_ranks
                    leaderboard_payload = ",".join(payload_parts)

                    # BROADCAST ke seluruh orang di room (Host & Semua Peserta) 
                    # supaya layarnya serentak memunculkan leaderboard sementara
                    room_data = active_rooms[pin]
                    asyncio.create_task(room_data["host"].send(f"LEADERBOARD_DATA;{pin};SERVER;{leaderboard_payload}"))
                    for p_username, p_ws in room_data["players"].items():
                        asyncio.create_task(p_ws.send(f"LEADERBOARD_DATA;{pin};SERVER;{leaderboard_payload}"))
                
                cursor.close()
                db.close()

            # ----------------------------------------------------
            # SCREEN SHARING SEDERHANA (ClassPoint Style)
            # ----------------------------------------------------
            elif action == "SHARE_SCREEN":
                if client_role != 'host':
                    continue
                
                # Payload berisi Base64 Image / URL Coretan Host
                screen_data = payload 
                
                # Broadcast langsung tanpa simpan DB (karena sifatnya sangat real-time & sementara)
                room_data = active_rooms[pin]
                for p_username, p_ws in room_data["players"].items():
                    asyncio.create_task(p_ws.send(f"SYNC_SCREEN;{pin};HOST;{screen_data}"))

    # ----------------------------------------------------
    # PENANGANAN TIMEOUT / DISCONNECT
    # ----------------------------------------------------
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # Jaringan terputus (bisa karena tutup browser atau pindah halaman)
        if client_pin in active_rooms:
            if client_role == 'participant':
                # Jika peserta yang putus, hapus dari memori jaringan aktif agar bisa rejoin aman
                if client_username in active_rooms[client_pin]["players"]:
                    del active_rooms[client_pin]["players"][client_username]
                    logging.info(f"Koneksi jaringan {client_username} terputus dari room {client_pin}")
            elif client_role == 'host':
                # ⚠️ JANGAN hapus active_rooms[client_pin] di sini!
                # Biarkan room tetap menggantung di memori server selama 1-2 detik 
                # sampai diambil alih kembali oleh perintah RECONNECT_HOST di halaman baru.
                logging.info(f"Host {client_username} sedang berpindah halaman pada room {client_pin}")

# Menjalankan Server di Port 8765
async def main():
    async with websockets.serve(handle_client, "localhost", 8765):
        logging.info("🚀 Server Quiz berjalan di ws://localhost:8765")
        await asyncio.Future()  # Berjalan selamanya

if __name__ == "__main__":
    asyncio.run(main())