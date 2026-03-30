import uuid
from typing import Dict, List, Optional
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from database import InterviewSessionModel, AsyncSessionLocal

class InterviewManager:
    @staticmethod
    async def create_session(domain: str, model_provider: str = "groq", resume_context: str = None) -> InterviewSessionModel:
        session_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            session = InterviewSessionModel(
                id=session_id,
                domain=domain,
                model_provider=model_provider,
                resume_context=resume_context,
                questions=[],
                answers=[],
                feedback=[],
                interview_stage='basic'
            )
            db.add(session)
            await db.commit()
            await db.refresh(session)
            return session

    @staticmethod
    async def get_session(session_id: str) -> Optional[InterviewSessionModel]:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(InterviewSessionModel).where(InterviewSessionModel.id == session_id))
            return result.scalar_one_or_none()

    @staticmethod
    async def update_session(session: InterviewSessionModel):
        async with AsyncSessionLocal() as db:
            db.add(session) # Re-attach to session
            await db.merge(session)
            await db.commit()

    @staticmethod
    async def end_session(session_id: str):
        async with AsyncSessionLocal() as db:
            await db.execute(delete(InterviewSessionModel).where(InterviewSessionModel.id == session_id))
            await db.commit()

def format_session_context(session: InterviewSessionModel) -> str:
    """Format history for the LLM prompt."""
    formatted = []
    if session.domain:
        formatted.append(f"Interview Domain: {session.domain}")
    
    if session.resume_context:
        formatted.append(f"Candidate Resume Summary: {session.resume_context[:2000]}") # Truncate for safety
        
    formatted.append(f"Interview Stage: {session.interview_stage}")
    formatted.append("\nInterview History:")

    # Pair questions with answers
    limit = min(len(session.questions), len(session.answers))
    for i in range(limit):
        formatted.append(f"Question {i + 1}: {session.questions[i]}")
        formatted.append(f"Answer {i + 1}: {session.answers[i]}")

    # Add any unpaired questions
    if len(session.questions) > len(session.answers):
        formatted.append(f"Question {len(session.questions)}: {session.questions[-1]}")
        formatted.append("(Awaiting answer)")

    if session.feedback:
        formatted.append("\nFeedback History:")
        for fb in session.feedback:
            formatted.append(f"- {fb}")

    return "\n".join(formatted)
