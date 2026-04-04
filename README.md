# 🎙️ AI Mock Interviewer Pro

A production-ready, asynchronous AI interviewer that simulates real-world job interviews using **Groq** and **Google Gemini**.

## ✨ Key Features
- **🚀 Ultra-Fast Responses**: Powered by Groq/Gemini with rapid-fire asynchronous HTTP logic.
- **📝 Resume-Aware Integration**: Targeted behavioral and technical questions based on uploaded PDF/DOCX.
- **🛡️ Automated Proctoring**: Strict "Soft Alert" watchdog keeps candidates focused (detects tab-switching, absence, etc.).
- **📊 Executive Cockpit**: High-density 8-axis performance dashboard with a single-page "Zero-Scroll" telemetry layout.
- **🖇️ Satin Scroll Architecture**: Internal vertically scrollable practice setup that keeps "Mission Control" buttons pinned.
- **🎨 Elite Glassmorphism**: Premium modern UI with interactive AI command buttons (Clarify/Repeat).
- **🔉 Real-Time TTS**: Professional AI speech synthesis for immersive session simulation.

## 🛠️ Technical Stack
- **Backend**: FastAPI, SQLAlchemy, aiohttp, PyPDF2.
- **Frontend**: Vanilla JS, Glassmorphic CSS.
- **Database**: SQLite (via `aiosqlite`).

## 🚀 Getting Started

### 1. Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### 2. Configure Environment
Create a `backend/.env` file with:
```env
GROQ_API_KEY1=your_key_here
GEMINI_API_KEY1=your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_MODEL=gemini-1.5-flash-latest
```

### 3. Run the Backend
```bash
python backend/main.py
```

### 4. Open the Interface
Open `interviewer.html` via a local server (e.g., VS Code Live Server).

## 🛡️ License
MIT License.
