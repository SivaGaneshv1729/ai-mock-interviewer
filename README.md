# 🎙️ AI Mock Interviewer Pro

A production-ready, asynchronous AI interviewer that simulates real-world job interviews using **Groq** and **Google Gemini**.

## ✨ Key Features
- **🚀 Ultra-Fast Responses**: Powered by Groq's Llama 3.3 and raw asynchronous HTTP calls (no-SDK hanging).
- **📝 Resume-Aware**: Upload PDF or DOCX resumes for tailored behavioral questions.
- **💼 HR & Technical Modes**: Switch between deep technical dives and behavioral HR rounds.
- **🏛️ Persistent Sessions**: All interviews are stored in an asynchronous SQLite database.
- **🎨 Glassmorphic UI**: A modern, responsive interface with interactive command buttons like "Clarify" and "Repeat".
- **🔉 Text-to-Speech**: Integrated speech synthesis for a natural interview experience.

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
