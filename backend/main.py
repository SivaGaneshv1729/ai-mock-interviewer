import os
import sys
import asyncio
import aiohttp
import json
from dotenv import load_dotenv
from loguru import logger

# Add the current directory and backend directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

# Load environment variables with absolute path
env_path = os.path.join(current_dir, ".env")
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path, override=True)
    logger.info(f"Loaded .env from {env_path}")
else:
    logger.warning(f".env file not found at {env_path}")

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
    from backend.interview_manager import InterviewManager, format_session_context
    from backend.database import init_db, get_db, InterviewSessionModel
except ImportError:
    from prompts import INTERVIEW_PROMPT_BASE, FEEDBACK_PROMPT_BASE, CLARIFY_PROMPT_BASE, SUMMARY_PROMPT_BASE
    from interview_manager import InterviewManager, format_session_context
    from database import init_db, get_db, InterviewSessionModel

def clean_key(key: str) -> str:
    """Robustly clean API keys."""
    if not key: return ""
    return str(key).strip().strip('"').strip("'")

class Settings(BaseSettings):
    groq_api_key1: str = clean_key(os.getenv("GROQ_API_KEY1", ""))
    groq_api_key2: str = clean_key(os.getenv("GROQ_API_KEY2", ""))
    gemini_api_key1: str = clean_key(os.getenv("GEMINI_API_KEY1", ""))
    groq_model: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash-latest")
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))

settings = Settings()

# Setup Logger
logger.remove()
LOG_DIR = os.path.join(current_dir, ".data")
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR, exist_ok=True)
    
logger.add(sys.stdout, colorize=True, format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>")
logger.add(os.path.join(LOG_DIR, "interview_backend.log"), rotation="10 MB")

# Diagnostic Check
def check_keys():
    g1 = settings.groq_api_key1
    gm = settings.gemini_api_key1
    logger.info(f"Groq Key Status: {'Configured (' + g1[:5] + '...)' if g1 else 'MISSING'}")
    logger.info(f"Gemini Key Status: {'Configured (' + gm[:5] + '...)' if gm else 'MISSING'}")

check_keys()

app = FastAPI(title="AI Mock Interviewer Pro")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def log_requests(request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"Response status: {response.status_code}")
    return response

def clean_ai_response(text: str) -> str:
    import re
    cleaned = re.sub(r'^(text|speech):\s*\[?', '', text, flags=re.IGNORECASE)
    cleaned = re.sub(r'\]$', '', cleaned)
    return cleaned.strip()

async def fetch_groq_completion(session: aiohttp.ClientSession, prompt: str, api_key: str) -> str:
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": settings.groq_model,
        "messages": [{"role": "user", "content": prompt}]
    }
    
    async with session.post(url, headers=headers, json=payload) as response:
        if response.status != 200:
            text = await response.text()
            raise Exception(f"Groq API Error {response.status}: {text}")
        data = await response.json()
        return data["choices"][0]["message"]["content"]

async def fetch_gemini_completion(session: aiohttp.ClientSession, prompt: str, api_key: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent?key={api_key}"
    headers = {
        "Content-Type": "application/json"
    }
    payload = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    
    async with session.post(url, headers=headers, json=payload) as response:
        if response.status != 200:
            text = await response.text()
            raise Exception(f"Gemini API Error {response.status}: {text}")
        data = await response.json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise Exception(f"Unexpected response format from Gemini: {data}")

async def call_llm(prompt: str, provider: str) -> str:
    logger.info(f"LLM Call Request [RAW-HTTP] -> {provider}")
    
    # Strict 15 second timeout for connection and reading
    timeout = aiohttp.ClientTimeout(total=15)
    
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            if provider == "groq":
                if not settings.groq_api_key1: raise Exception("Groq primary key not configured.")
                try:
                    res = await fetch_groq_completion(session, prompt, settings.groq_api_key1)
                    logger.info("Groq primary call successful.")
                    return clean_ai_response(res)
                except Exception as e:
                    logger.warning(f"Groq primary failed: {e}")
                    if settings.groq_api_key2:
                        res = await fetch_groq_completion(session, prompt, settings.groq_api_key2)
                        logger.info("Groq fallback call successful.")
                        return clean_ai_response(res)
                    raise
            
            elif provider == "gemini":
                if not settings.gemini_api_key1: raise Exception("Gemini key not configured.")
                res = await fetch_gemini_completion(session, prompt, settings.gemini_api_key1)
                logger.info("Gemini call successful.")
                return clean_ai_response(res)
                
            raise Exception(f"Unknown provider: {provider}")

    except asyncio.TimeoutError:
        logger.error(f"LLM HTTP Timeout [{provider}] after 15s")
        raise HTTPException(status_code=504, detail=f"AI Service Timeout: {provider} is not responding.")
    except Exception as e:
        logger.error(f"LLM HTTP Error [{provider}]: {str(e)}")
        raise HTTPException(status_code=503, detail=f"AI Service Error: {str(e)}")

@app.on_event("startup")
async def startup():
    await init_db()
    logger.info("Database connection established & RAW HTTP clients ready.")

def extract_text(content: bytes, filename: str) -> str:
    try:
        if filename.endswith(".pdf"):
            pdf = PyPDF2.PdfReader(io.BytesIO(content))
            return "\n".join([p.extract_text() for p in pdf.pages[:10]])
        elif filename.endswith(".docx"):
            doc = docx.Document(io.BytesIO(content))
            return "\n".join([p.text for p in doc.paragraphs])
        return content.decode("utf-8", errors="ignore")
    except Exception as e:
        logger.error(f"File extraction error: {e}")
        return f"Error extracting {filename}"

@app.post("/api/interview/start")
async def start(domain: str = Form(...), model_provider: str = Form("groq"), resume: UploadFile = File(None)):
    logger.info(f"Starting interview: Domain={domain}, Provider={model_provider}")
    resume_text = ""
    if resume:
        resume_text = extract_text(await resume.read(), resume.filename)
    
    session = await InterviewManager.create_session(domain, model_provider, resume_context=resume_text)
    
    if "hr" in domain.lower() or "human resource" in domain.lower():
        prompt = f"Conduct an HR behavioral interview. Resume: {resume_text[:2000]}. Ask a personalized first behavioral question."
    elif resume_text:
        prompt = f"Conduct a {domain} interview. Candidate resume: {resume_text[:2000]}. Ask a technical first question based on their actual background."
    else:
        prompt = INTERVIEW_PROMPT_BASE.format(domain=domain, stage="basic", context="Starting session.", lastResponse="Start")

    question = await call_llm(prompt, model_provider)
    session.questions.append(question)
    await InterviewManager.update_session(session)
    return {"session_id": session.id, "reply": question}

class AnswerReq(BaseModel):
    session_id: str
    answer: str

@app.post("/api/interview/answer")
async def answer(req: AnswerReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session: raise HTTPException(404, "Session not found")
    
    session.answers.append(req.answer)
    session.last_user_response = req.answer
    if len(session.questions) >= 5: session.interview_stage = "technical"
    
    context = format_session_context(session)
    prompt = INTERVIEW_PROMPT_BASE.format(domain=session.domain, stage=session.interview_stage, context=context, lastResponse=req.answer)
    
    question = await call_llm(prompt, session.model_provider)
    session.questions.append(question)
    await InterviewManager.update_session(session)
    return {"reply": question}

@app.post("/api/interview/clarify")
async def clarify(req: AnswerReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session: raise HTTPException(404, "Session not found")
    
    last_q = session.questions[-1] if session.questions else "No question asked yet."
    context = format_session_context(session)
    prompt = CLARIFY_PROMPT_BASE.format(domain=session.domain, context=context, question=last_q, lastResponse=session.last_user_response or "None")
    
    clarification = await call_llm(prompt, session.model_provider)
    return {"reply": clarification}

@app.post("/api/interview/feedback")
async def feedback(req: AnswerReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session: raise HTTPException(404, "Session not found")
    
    context = format_session_context(session)
    prompt = FEEDBACK_PROMPT_BASE.format(domain=session.domain, context=context, lastResponse=session.last_user_response)
    
    fb = await call_llm(prompt, session.model_provider)
    session.feedback.append(fb)
    await InterviewManager.update_session(session)
    return {"reply": fb}

@app.post("/api/interview/end")
async def end(req: AnswerReq):
    session = await InterviewManager.get_session(req.session_id)
    if not session: raise HTTPException(404, "Session not found")
    
    context = format_session_context(session)
    prompt = SUMMARY_PROMPT_BASE.format(domain=session.domain, context=context)
    summary = await call_llm(prompt, session.model_provider)
    await InterviewManager.end_session(session.id)
    return {"reply": markdown2.markdown(summary)}

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting RAW HTTP server on {settings.host}:{settings.port}")
    uvicorn.run(app, host=settings.host, port=settings.port)
