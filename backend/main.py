import os
import sys
import json
import asyncio
import aiohttp
from dotenv import load_dotenv
from loguru import logger

# Path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

# Load .env
env_path = os.path.join(current_dir, ".env")
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path, override=True)
    logger.info(f"Loaded .env from {env_path}")
else:
    logger.warning(f".env not found at {env_path}")

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
import io
import markdown2
import PyPDF2
import docx

try:
    from backend.prompts import INTERVIEW_PROMPT_BASE, FEEDBACK_PROMPT_BASE, CLARIFY_PROMPT_BASE, SUMMARY_PROMPT_BASE
    from backend.scoring_prompt import SCORING_PROMPT
    from backend.interview_manager import InterviewManager, format_session_context
    from backend.database import init_db, get_db, InterviewSessionModel
    from backend.llm_clients import GroqClient, GeminiClient, OllamaClient
except ImportError:
    from prompts import INTERVIEW_PROMPT_BASE, FEEDBACK_PROMPT_BASE, CLARIFY_PROMPT_BASE, SUMMARY_PROMPT_BASE
    from scoring_prompt import SCORING_PROMPT
    from interview_manager import InterviewManager, format_session_context
    from database import init_db, get_db, InterviewSessionModel
    from llm_clients import GroqClient, GeminiClient, OllamaClient


def clean_key(key: str) -> str:
    if not key:
        return ""
    return str(key).strip().strip('"').strip("'")


class Settings(BaseSettings):
    groq_api_key1: str = ""
    groq_api_key2: str = ""
    gemini_api_key1: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_model: str = "gemini-2.5-flash"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3"
    host: str = "0.0.0.0"
    port: int = 8000

    class Config:
        case_sensitive = False
        env_file = ".env"
        extra = "allow"

    def model_post_init(self, __context):
        self.groq_api_key1 = clean_key(self.groq_api_key1)
        self.groq_api_key2 = clean_key(self.groq_api_key2)
        self.gemini_api_key1 = clean_key(self.gemini_api_key1)
        self.ollama_base_url = clean_key(self.ollama_base_url)


from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

settings = Settings()

# Logger setup
logger.remove()
LOG_DIR = os.path.join(current_dir, ".data")
os.makedirs(LOG_DIR, exist_ok=True)
logger.add(sys.stdout, colorize=True, format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>")
logger.add(os.path.join(LOG_DIR, "interview_backend.log"), rotation="10 MB")


def check_keys():
    g1, gm = settings.groq_api_key1, settings.gemini_api_key1
    logger.info(f"Groq Key: {'OK (' + g1[:5] + '...)' if g1 else 'MISSING'}")
    logger.info(f"Gemini Key: {'OK (' + gm[:5] + '...)' if gm else 'MISSING'}")
    logger.info(f"Ollama URL: {settings.ollama_base_url} (Model: {settings.ollama_model})")


check_keys()

app = FastAPI(title="AI Mock Interviewer Pro")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

# Serve frontend files
# The project root is one level up from the 'backend' directory
project_root = os.path.dirname(current_dir)
frontend_dir = os.path.join(project_root, "frontend")

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(frontend_dir, "interviewer.html"))


@app.middleware("http")
async def log_requests(request, call_next):
    # ... (rest of middleware stays same)
    response = await call_next(request)
    return response


# ── Interview Endpoints (rest of them here) ──

# ... (I'll just move the mount to the very end of the file in the full tool call)
    logger.info(f"► {request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"◄ {response.status_code}")
    return response


# ─────────────────────────────────────────────────────────────
# LLM call helper
# ─────────────────────────────────────────────────────────────
async def call_llm(prompt: str, provider: str) -> str:
    logger.info(f"LLM → {provider}")
    timeout = aiohttp.ClientTimeout(total=30)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            if provider == "groq":
                if not settings.groq_api_key1:
                    raise Exception("Groq primary key not configured.")
                client1 = GroqClient(settings.groq_api_key1, settings.groq_model)
                try:
                    res = await client1.get_completion(session, prompt)
                    logger.info("Groq primary ✓")
                    return res
                except Exception as e:
                    logger.warning(f"Groq primary failed: {e}")
                    if settings.groq_api_key2:
                        client2 = GroqClient(settings.groq_api_key2, settings.groq_model)
                        res = await client2.get_completion(session, prompt)
                        logger.info("Groq fallback ✓")
                        return res
                    raise
            elif provider == "gemini":
                if not settings.gemini_api_key1:
                    raise Exception("Gemini key not configured.")
                client = GeminiClient(settings.gemini_api_key1, settings.gemini_model)
                res = await client.get_completion(session, prompt)
                logger.info("Gemini ✓")
                return res
            elif provider == "ollama":
                client = OllamaClient(settings.ollama_base_url, settings.ollama_model)
                res = await client.get_completion(session, prompt)
                logger.info("Ollama ✓")
                return res
            raise Exception(f"Unknown provider: {provider}")
    except asyncio.TimeoutError:
        logger.error(f"Timeout [{provider}]")
        raise HTTPException(504, f"AI timeout: {provider} not responding.")
    except Exception as e:
        logger.error(f"LLM error [{provider}]: {e}")
        raise HTTPException(503, f"AI error: {str(e)}")


# ─────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    await init_db()
    logger.info("DB ready. RAW HTTP clients ready.")


# ─────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────
def clean_ai_response(text: str) -> str:
    import re
    cleaned = re.sub(r'^(text|speech):\s*\[?', '', text, flags=re.IGNORECASE)
    cleaned = re.sub(r'\]$', '', cleaned)
    return cleaned.strip()


def extract_text(content: bytes, filename: str) -> str:
    try:
        if filename.endswith(".pdf"):
            pdf = PyPDF2.PdfReader(io.BytesIO(content))
            return "\n".join([p.extract_text() or "" for p in pdf.pages[:10]])
        elif filename.endswith(".docx"):
            doc = docx.Document(io.BytesIO(content))
            return "\n".join([p.text for p in doc.paragraphs])
        return content.decode("utf-8", errors="ignore")
    except Exception as e:
        logger.error(f"File extraction error: {e}")
        return ""


def parse_score(raw: str) -> dict:
    """Safely parse LLM JSON score response."""
    try:
        import re
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            return json.loads(match.group())
    except Exception as e:
        logger.warning(f"Score parse failed: {e}")
    return {
        "overall": 70, "technical": 70, "problem_solving": 70, 
        "communication": 70, "clarity": 70, "confidence": 70,
        "strengths": ["Completed the interview"], "improvements": ["Practice more"]
    }


# ─────────────────────────────────────────────────────────────
# Interview Endpoints
# ─────────────────────────────────────────────────────────────
@app.post("/api/interview/start")
async def start(domain: str = Form(...), model_provider: str = Form("groq"), resume: UploadFile = File(None)):
    logger.info(f"Start: domain={domain}, provider={model_provider}")
    resume_text = ""
    if resume and resume.filename:
        resume_text = extract_text(await resume.read(), resume.filename)

    session = await InterviewManager.create_session(domain, model_provider, resume_context=resume_text)

    if "hr" in domain.lower() or "human resource" in domain.lower():
        prompt = f"Conduct an HR behavioral interview. Resume: {resume_text[:2000]}. Ask a personalized first behavioral question."
    elif resume_text:
        prompt = f"Conduct a {domain} interview based on this resume: {resume_text[:2000]}. Ask a targeted first technical question."
    else:
        prompt = INTERVIEW_PROMPT_BASE.format(domain=domain, stage="basic", context="Starting session.", lastResponse="Start")

    question = await call_llm(prompt, model_provider)
    session.questions.append(question)
    await InterviewManager.update_session(session)
    return {"session_id": session.id, "reply": question}


class SessionReq(BaseModel):
    session_id: str
    answer: str = ""
    security_log: list = []   # cheat/face detection events from camera module


@app.post("/api/interview/answer")
async def answer(req: SessionReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    session.answers.append(req.answer)
    session.last_user_response = req.answer
    if len(session.questions) >= 5:
        session.interview_stage = "technical"

    context = format_session_context(session)
    prompt = INTERVIEW_PROMPT_BASE.format(
        domain=session.domain, stage=session.interview_stage,
        context=context, lastResponse=req.answer
    )
    question = await call_llm(prompt, session.model_provider)
    session.questions.append(question)
    await InterviewManager.update_session(session)
    return {"reply": question}


@app.post("/api/interview/clarify")
async def clarify(req: SessionReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    last_q = session.questions[-1] if session.questions else "No question asked yet."
    context = format_session_context(session)
    prompt = CLARIFY_PROMPT_BASE.format(
        domain=session.domain, context=context,
        question=last_q, lastResponse=session.last_user_response or "None"
    )
    clarification = await call_llm(prompt, session.model_provider)
    return {"reply": clarification}


@app.post("/api/interview/feedback")
async def feedback(req: SessionReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    context = format_session_context(session)
    prompt = FEEDBACK_PROMPT_BASE.format(
        domain=session.domain, context=context,
        lastResponse=session.last_user_response
    )
    fb = await call_llm(prompt, session.model_provider)
    session.feedback.append(fb)
    await InterviewManager.update_session(session)
    return {"reply": fb}


@app.post("/api/interview/end")
async def end(req: SessionReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    context = format_session_context(session)

    # Generate summary
    summary_prompt = SUMMARY_PROMPT_BASE.format(domain=session.domain, context=context)
    summary_raw = await call_llm(summary_prompt, session.model_provider)
    summary_html = markdown2.markdown(summary_raw)

    # Generate structured score
    score_prompt = SCORING_PROMPT.format(domain=session.domain, context=context)
    try:
        score_raw = await call_llm(score_prompt, session.model_provider)
        score = parse_score(score_raw)
    except Exception as e:
        logger.warning(f"Scoring failed, using defaults: {e}")
        score = {"overall": 70, "communication": 70, "technical": 70, "confidence": 70,
                 "strengths": ["Completed the interview"], "improvements": ["Keep practising"]}

    # Persist — mark completed (not delete)
    await InterviewManager.complete_session(req.session_id, summary_html, score, req.security_log)

    return {
        "reply": summary_html,
        "score": score,
        "security_log": req.security_log,
        "session_id": req.session_id
    }


# ─────────────────────────────────────────────────────────────
# History & Session Detail Endpoints (v2.0)
# ─────────────────────────────────────────────────────────────
@app.get("/api/interview/history")
async def get_history():
    sessions = await InterviewManager.get_history()
    result = []
    for s in sessions:
        result.append({
            "session_id": s.id,
            "domain": s.domain,
            "model_provider": s.model_provider,
            "questions_count": len(s.questions) if s.questions else 0,
            "score": s.score,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })
    return {"history": result}


@app.get("/api/interview/session/{session_id}")
async def get_session_detail(session_id: str):
    session = await InterviewManager.get_session_detail(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return {
        "session_id": session.id,
        "domain": session.domain,
        "model_provider": session.model_provider,
        "status": session.status,
        "questions": session.questions,
        "answers": session.answers,
        "feedback": session.feedback,
        "score": session.score,
        "summary": session.summary,
        "security_log": session.security_log or [],
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "created_at": session.created_at.isoformat() if session.created_at else None,
    }


# ── Frontend Static Serving (Must be last) ──
@app.get("/interviewer_app")
async def read_interviewer_app():
    return FileResponse(os.path.join(frontend_dir, "interviewer.html"))


app.mount("/", StaticFiles(directory=frontend_dir), name="static")


if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting server on {settings.host}:{settings.port}")
    uvicorn.run(app, host=settings.host, port=settings.port)
