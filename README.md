# 📸 CapCut Snapshot Studio (Snapshot-Studio)

โปรแกรมพรีวิววิดีโอ แคปภาพตรงเป๊ะแบบเลือกจุด และลากวางซ้อนภาพทับแทร็กเสียงพูดอัตโนมัติ สำหรับ CapCut PC (ระบบค้นหาพิกัดวิดีโอแบบเฟรมตรง 100% พร้อมฟิลเตอร์เร่งความชัดลายเส้น CAS และระบบลากวาง Storyboard จัดเรียงงาน)

This is a local web application for CapCut PC that allows you to play source videos (including raw `.ts` files), perform frame-accurate image captures (with AMD CAS detail sharpening), and drag-and-drop these captures directly onto voiceover clips on a storyboard to auto-inject them into your CapCut timeline.

---

## 🛠️ Technology Stack (เทคโนโลยีที่ใช้)

1. **Backend Server**:
   * **Python 3.10+** (Flask Framework)
   * **Flask-CORS** (cross-origin resource sharing)
   * **psutil** (to monitor and safely close CapCut to prevent database SQLite lockups)
2. **Frontend UI (Aesthetics & Logic)**:
   * **Vanilla HTML5 & CSS3** (curated sleeks, dynamic glassmorphism cards, and interactive hover feedback)
   * **JavaScript (Vanilla)** for video player control, global keyboard shortcuts, drag-and-drop bindings, and custom audio streaming controls.
3. **Audio Playback Engine**:
   * **Web Audio API** (dynamically parses segment timestamps to play/stream only the specific voiceovers from parent records)
4. **Media Processing**:
   * **FFmpeg** (using a two-stage seeking method combining **Fast Seek** and **Output Precise Seek** to retrieve snapshots in under 2 seconds)
   * **AMD CAS (Contrast Adaptive Sharpening)** and **Unsharp Masking** FFmpeg filters to dynamically enhance image lines.
5. **Database Interaction**:
   * Direct **JSON/SQLite database modification** of CapCut's internal timeline draft database (`draft_content.json`), ensuring seamless native timeline editing.

---

## 📦 Requirements (สิ่งที่ต้องติดตั้ง)

* **Operating System**: Windows (where CapCut PC is installed)
* **Python**: Version 3.10 or higher
* **CapCut PC**: App installed on the system (the app automatically resolves CapCut executable paths and FFmpeg libraries)

---

## 🚀 Installation & Running on a New Machine (วิธีติดตั้งและเปิดใช้งานเครื่องใหม่)

1. **Clone this repository**:
   ```bash
   git clone https://github.com/Lskram/Snapshot-Studio.git
   cd Snapshot-Studio
   ```

2. **One-Click Run (ดับเบิ้ลคลิกเพื่อรัน)**:
   * Double-click **`run.bat`** in the project folder.
   * This script will automatically install all required packages listed in `requirements.txt` via `pip` and start the server.

3. **Manual Run (สั่งงานผ่าน Terminal)**:
   ```bash
   pip install -r requirements.txt
   python app.py
   ```

4. **Access the Web Interface**:
   * Open your browser and navigate to: **`http://127.0.0.1:5001`**

---

## 🎮 Keyboard Hotkeys & Controls (ปุ่มคีย์บอร์ดควบคุมวิดีโอ)

While operating the video player on the website, you can use these keys:
* **`Spacebar`**: Play / Pause video.
* **`Arrow Right`**: Seek forward **2.0 seconds** (with smooth playback buffering override).
* **`Arrow Left`**: Seek backward **2.0 seconds** (with smooth playback buffering override).
* **`. (Period / >)`**: Step forward **1 frame** (0.033s) for frame-accurate scrubbing.
* **`, (Comma / <)`**: Step backward **1 frame** (0.033s) for frame-accurate scrubbing.
* **`S` (Default - Customize in UI)**: Takes a snapshot at the current timecode, sharpens details, and registers it.

---

## 🌟 Key Features (ฟีเจอร์เด่น)

1. **Frame-Accurate Snapshot**:
   * Output seeking captures the exact frame shown on screen.
   * AMD CAS filters sharpen drawing outlines automatically.
2. **Storyboard Drag & Drop**:
   * Displays all voice transcripts from your target audio timeline.
   * Drag snapshots from the gallery and drop them onto voiceover rows.
   * Auto-injects them as video track images at the exact time code in the database.
3. **Listen to Voice Segment**:
   * Interactive "Listen" button plays the exact audio segment slice matching the speech bubble.
4. **App Control**:
   * `🚀 Open CapCut` and `⏹ Close CapCut` buttons built directly into the header to control CapCut and database locks.
5. **Batch Deletion**:
   * Multi-selection gallery checks to remove wrong captures in bulk from both the web UI and hard drive.
6. **Local Workspace Memory**:
   * Automatically remembers your selected project, timeline, path, and snapshot history across browser refreshes.
