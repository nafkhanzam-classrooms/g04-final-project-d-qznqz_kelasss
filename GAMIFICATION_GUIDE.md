# QuITS Gamification System Guide

## 📊 Overview

The QuITS platform now features a comprehensive gamification system with three main components:

1. **Point System** - Time-based scoring
2. **Streak Bonus** - Progressive multipliers for consecutive correct answers
3. **Ranking System** - Dynamic leaderboard with real-time updates

---

## 🎯 Point System

### Base Points: 250

The scoring is based on **how quickly** the player answers:

#### Formula:
```text
base_points = 250

If answer_time ≤ 3 seconds:
  points = base_points

If answer_time > 3 seconds:
  points = base_points - (answer_time - 3)
  minimum = 100 points

```

#### Examples:

* ✅ Answer in 1.5 seconds → **250 points**
* ✅ Answer in 3.0 seconds → **250 points**
* ✅ Answer in 5.0 seconds → **248 points** (250 - 2)
* ✅ Answer in 10.0 seconds → **243 points** (250 - 7)
* ❌ Incorrect answer → **0 points**

---

## 🔥 Streak Bonus System

### Progressive Multipliers

When a player answers correctly, their **streak increases** and each point is multiplied accordingly.

#### Multiplier Formula:

```text
multiplier = 1.0 + (streak - 1) × 0.125

```

#### Streak Progression:

| Streak | Multiplier | Example (250 perfect) |
| --- | --- | --- |
| 1st correct | 1.000× | 250 × 1.000 = 250 pts |
| 2nd correct | 1.125× | 250 × 1.125 = 281 pts |
| 3rd correct | 1.250× | 250 × 1.250 = 312 pts |
| 4th correct | 1.375× | 250 × 1.375 = 343 pts |
| 5th correct | 1.500× | 250 × 1.500 = 375 pts |
| 10th correct | 2.125× | 250 × 2.125 = 531 pts |

#### Streak Reset:

* ❌ Incorrect answer → **Streak resets to 0**
* 🔄 Next correct answer after reset → **Back to 1× multiplier**

---

## 💰 Final Score Calculation

The final score earned per question is calculated as:

```text
final_score = base_points × streak_multiplier

```

### Example Scenario:

Player has a correct streak of 3, answers question in 4 seconds:

```text
base_points = 250 - (4 - 3) = 249 points
streak_multiplier = 1.0 + (3 - 1) × 0.125 = 1.25
final_score = 249 × 1.25 = 311 points (rounded)
total_score += 311

```

---

## 🏆 Ranking System

### Features:

* **Real-time Leaderboard** - Updated after each answer
* **Temporary Rankings** - Shown between questions (5-second interval)
* **Final Leaderboard** - Complete rankings at quiz end

### Sorting:

Players are ranked by **total score** in descending order:

1. 🥇 Highest score
2. 🥈 Second highest
3. 🥉 Third highest
4. ... and so on

### Medal Display:

* 🥇 1st Place
* 🥈 2nd Place
* 🥉 3rd Place

---

## 📱 User Interface

### During Quiz:

* **Timer Display** - Shows elapsed time for current question
* **Point Breakdown** - After answering:
* ⏱️ Time taken
* 📊 Base points
* ✨ Streak multiplier
* 💰 Points earned this question
* 📈 Running total score



### After Each Answer:

Feedback includes:

* ✅ Correct/❌ Wrong status
* 🔥 Current streak count
* Detailed score calculation
* Meme response (correct or wrong)

### Leaderboard Screen:

* Personal score prominently displayed
* Full rankings with all players
* Scoring system explanation card

---

## 🗄️ Database Schema Updates

### `answers` Table - New Columns:

```sql
- answer_time_ms INT          # Time from question show to answer (milliseconds)
- points_earned INT           # Points awarded for this answer
- streak_at_answer INT        # Streak count at time of answering

```

### `players` Table - Existing Columns:

```sql
- score INT          # Running total score
- streak INT         # Current streak (0 if reset)

```

---

## 🔧 Technical Implementation

### Server-Side (Python):

**Scoring Functions:**

```python
def calculate_points(answer_time_ms: int, is_correct: bool) -> int:
    # Returns base points (100-250 based on speed)

def calculate_streak_multiplier(streak: int) -> float:
    # Returns multiplier (1.0+)

def calculate_final_score(base_points: int, streak: int) -> int:
    # Returns final score with multiplier applied

```

### Client-Side (JavaScript):

**Timing:**

* Question timestamp captured on `SHOW_QUESTION`
* Answer timestamp sent with `ANSWER` packet
* Server calculates time difference

**Display:**

* Real-time timer on quiz page
* Point breakdown after answer
* Updated leaderboard rankings

---

## 📊 Example Game Scenario

**Settings: 30 second timer**

**Question 1:**

* Player A answers correctly in 2 seconds
* Points: 250 × 1.0 = 250 (Streak: 1)
* Total: 250

**Question 2:**

* Player A answers correctly in 5 seconds
* Points: (250 - 2) × 1.125 = 248 × 1.125 = 279 (Streak: 2)
* Total: 529

**Question 3:**

* Player A answers **incorrectly** in 3 seconds
* Points: 0 (Streak reset to 0)
* Total: 529

**Question 4:**

* Player A answers correctly in 4 seconds
* Points: (250 - 1) × 1.0 = 249 (Streak: 1)
* Total: 778

---

## 🎮 Game Strategy Tips

1. **Speed Matters** - Answer in the first 3 seconds for maximum base points (250).
2. **Build Streaks** - Consistent correct answers multiply your points heavily.
3. **Accuracy First** - Wrong answers reset streak, costing massive potential points.
4. **Early Bird** - Players answering faster on each question build up scores significantly faster.

---

## ⚙️ Configuration

Quiz settings are configurable by the host in the lobby:

* **Jumlah Soal** (Number of Questions): 1-50
* **Timer per Soal** (Timer per Question): 5-120 seconds

*Note: The timer limits the maximum time a player has to submit an answer. The scoring formula independently uses 250 as the fixed maximum base points, regardless of the timer duration.*

* Answer in **first 3 seconds** = full base points (250)
* After 3 seconds = -1 point per second (minimum 100 points)
* **Streak multiplier** always applies: 1.0 → 1.125 → 1.25 → 1.375...

---

## 🔄 Data Flow

```text
1. Host sends question
   ↓
2. Server timestamps question (SHOW_QUESTION)
   ↓
3. Client displays question + starts timer
   ↓
4. Player answers
   ↓
5. Client sends answer + timestamp
   ↓
6. Server calculates:
   - Time difference
   - Base points
   - New streak
   - Final score
   ↓
7. Server sends ANSWER_RESULT with breakdown
   ↓
8. Client displays feedback + updates score
   ↓
9. Server broadcasts updated leaderboard
   ↓
10. All clients update rankings

```

## 📝 Notes

* Time calculations use milliseconds for precision
* Streak bonuses compound (multiplicative, not additive)
* Score is stored as integer (decimals truncated)
* All calculations happen server-side for fairness
* Timer is client-side display only (server is source of truth)
