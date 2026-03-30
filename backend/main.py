from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from groq import Groq
from google import genai
import markdown2

try:
    from backend.prompts import INTERVIEW_PROMPT_BASE, FEEDBACK_PROMPT_BASE, CLARIFY_PROMPT_BASE, SUMMARY_PROMPT_BASE
    from backend.interview_manager import InterviewManager
except ImportError:
    from prompts import INTERVIEW_PROMPT_BASE, FEEDBACK_PROMPT_BASE, CLARIFY_PROMPT_BASE, SUMMARY_PROMPT_BASE
    from interview_manager import InterviewManager

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup LLM Providers
# --- Groq ---
api_key1_groq = os.getenv("GROQ_API_KEY1")
api_key2_groq = os.getenv("GROQ_API_KEY2")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
client1_groq = Groq(api_key=api_key1_groq) if api_key1_groq else None
client2_groq = Groq(api_key=api_key2_groq) if api_key2_groq else None

# --- Gemini ---
api_key_gemini = os.getenv("GEMINI_API_KEY1")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
client_gemini = genai.Client(api_key=api_key_gemini) if api_key_gemini else None


class StartInterviewRequest(BaseModel):
    domain: str
    model_provider: str = "groq"  # Default to groq


class AnswerRequest(BaseModel):
    session_id: str
    answer: str


class FeedbackRequest(BaseModel):
    session_id: str


class ClarifyRequest(BaseModel):
    session_id: str


class EndInterviewRequest(BaseModel):
    session_id: str


def call_groq(prompt: str, client: Groq) -> str:
    """Helper to call Groq API."""
    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model=GROQ_MODEL,
    )
    return chat_completion.choices[0].message.content


def call_gemini(prompt: str, client: genai.Client) -> str:
    """Helper to call Gemini API."""
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt
    )
    return response.text


async def call_llm(prompt: str, provider: str) -> str:
    """Master function to call the appropriate LLM provider."""
    if provider == "groq":
        if not client1_groq:
            raise HTTPException(status_code=400, detail="Groq API Key not configured.")
        try:
            return call_groq(prompt, client1_groq)
        except Exception as e1:
            print(f"Groq Client 1 failed: {e1}")
            if client2_groq:
                try:
                    return call_groq(prompt, client2_groq)
                except Exception as e2:
                    print(f"Groq Client 2 failed: {e2}")
            raise HTTPException(status_code=503, detail="Groq service unavailable.")
            
    elif provider == "gemini":
        if not client_gemini:
            raise HTTPException(status_code=400, detail="Gemini API Key not configured.")
        try:
            return call_gemini(prompt, client_gemini)
        except Exception as e:
            print(f"Gemini failed: {e}")
            raise HTTPException(status_code=503, detail=f"Gemini service unavailable: {str(e)}")
            
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")


@app.get("/")
async def root():
    return {
        "status": "AI Mock Interviewer backend is running",
        "providers": {
            "groq": {"active": client1_groq is not None, "model": GROQ_MODEL},
            "gemini": {"active": client_gemini is not None, "model": GEMINI_MODEL}
        }
    }


@app.post("/api/interview/start")
async def start_interview(req: StartInterviewRequest):
    session = InterviewManager.create_session(req.domain, req.model_provider)

    prompt = INTERVIEW_PROMPT_BASE.format(
        domain=session.domain,
        stage=session.interview_stage,
        context="No history yet.",
        lastResponse="Starting interview"
    )

    question = await call_llm(prompt, session.model_provider)
    session.questions.append(question)

    return {"session_id": session.session_id, "reply": question}


@app.post("/api/interview/answer")
async def answer_question(req: AnswerRequest):
    session = InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.answers.append(req.answer)
    session.last_user_response = req.answer

    if session.interview_stage == "basic" and len(session.questions) >= 5:
        session.interview_stage = "technical"

    formatted_context = session.format_context()

    prompt = INTERVIEW_PROMPT_BASE.format(
        domain=session.domain,
        stage=session.interview_stage,
        context=formatted_context,
        lastResponse=session.last_user_response
    )

    question = await call_llm(prompt, session.model_provider)
    session.questions.append(question)

    return {"reply": question}


@app.post("/api/interview/feedback")
async def get_feedback(req: FeedbackRequest):
    session = InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.last_user_response:
        return {"reply": "Please answer a question first before requesting feedback."}

    formatted_context = session.format_context()

    prompt = FEEDBACK_PROMPT_BASE.format(
        domain=session.domain,
        context=formatted_context,
        lastResponse=session.last_user_response
    )

    feedback = await call_llm(prompt, session.model_provider)
    session.feedback.append(feedback)

    return {"reply": feedback}


@app.post("/api/interview/clarify")
async def clarify_question(req: ClarifyRequest):
    session = InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.questions:
        return {"reply": "No question to clarify yet."}

    last_question = session.questions[-1]
    formatted_context = session.format_context()

    prompt = CLARIFY_PROMPT_BASE.format(
        domain=session.domain,
        context=formatted_context,
        question=last_question,
        lastResponse=session.last_user_response or "No response yet"
    )

    clarification = await call_llm(prompt, session.model_provider)
    return {"reply": clarification}


@app.post("/api/interview/end")
async def end_interview(req: EndInterviewRequest):
    session = InterviewManager.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    formatted_context = session.format_context()

    prompt = SUMMARY_PROMPT_BASE.format(
        domain=session.domain,
        context=formatted_context
    )

    summary = await call_llm(prompt, session.model_provider)
    summary_html = markdown2.markdown(summary)

    InterviewManager.end_session(req.session_id)

    return {"reply": summary_html}


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host=host, port=port)
