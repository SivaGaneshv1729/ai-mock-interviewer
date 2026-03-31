import uuid
import datetime
from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from database import InterviewSessionModel, AsyncSessionLocal
except ImportError:
    from backend.database import InterviewSessionModel, AsyncSessionLocal


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
                interview_stage="basic",
                status="active",
            )
            db.add(session)
            await db.commit()
            await db.refresh(session)
            return session

    @staticmethod
    async def get_session(session_id: str) -> Optional[InterviewSessionModel]:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(InterviewSessionModel).where(InterviewSessionModel.id == session_id)
            )
            return result.scalar_one_or_none()

    @staticmethod
    async def update_session(session: InterviewSessionModel):
        async with AsyncSessionLocal() as db:
            await db.merge(session)
            await db.commit()

    @staticmethod
    async def complete_session(session_id: str, summary: str, score: dict):
        """Mark session as completed with summary and score — does NOT delete."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(InterviewSessionModel).where(InterviewSessionModel.id == session_id)
            )
            session = result.scalar_one_or_none()
            if session:
                session.status = "completed"
                session.summary = summary
                session.score = score
                session.ended_at = datetime.datetime.utcnow()
                await db.merge(session)
                await db.commit()

    @staticmethod
    async def get_history() -> List[InterviewSessionModel]:
        """Return all completed sessions, newest first."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(InterviewSessionModel)
                .where(InterviewSessionModel.status == "completed")
                .order_by(InterviewSessionModel.ended_at.desc())
            )
            return result.scalars().all()

    @staticmethod
    async def get_session_detail(session_id: str) -> Optional[InterviewSessionModel]:
        """Return a completed session by ID for dashboard view."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(InterviewSessionModel).where(InterviewSessionModel.id == session_id)
            )
            return result.scalar_one_or_none()


def format_session_context(session: InterviewSessionModel) -> str:
    """Format history for the LLM prompt."""
    formatted = []
    if session.domain:
        formatted.append(f"Interview Domain: {session.domain}")
    if session.resume_context:
        formatted.append(f"Candidate Resume Summary: {session.resume_context[:2000]}")
    formatted.append(f"Interview Stage: {session.interview_stage}")
    formatted.append("\nInterview History:")

    limit = min(len(session.questions), len(session.answers))
    for i in range(limit):
        formatted.append(f"Question {i + 1}: {session.questions[i]}")
        formatted.append(f"Answer {i + 1}: {session.answers[i]}")

    if len(session.questions) > len(session.answers):
        formatted.append(f"Question {len(session.questions)}: {session.questions[-1]}")
        formatted.append("(Awaiting answer)")

    if session.feedback:
        formatted.append("\nFeedback History:")
        for fb in session.feedback:
            formatted.append(f"- {fb}")

    return "\n".join(formatted)
