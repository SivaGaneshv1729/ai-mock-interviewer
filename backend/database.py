import os
from sqlalchemy import Column, String, Text, DateTime, JSON
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import datetime

# Database settings
DATA_DIR = os.path.join(os.path.dirname(__file__), ".data")
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, "interviews.db")
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

class Base(DeclarativeBase):
    pass

class InterviewSessionModel(Base):
    __tablename__ = "interview_sessions"
    
    id = Column(String, primary_key=True) # session_id (UUID)
    domain = Column(String, nullable=False)
    model_provider = Column(String, default="groq")
    interview_stage = Column(String, default="basic")
    resume_context = Column(Text, nullable=True)
    last_user_response = Column(Text, nullable=True)
    
    # Store lists as JSON strings (SQLite handles this via JSON type)
    questions = Column(JSON, default=list)
    answers = Column(JSON, default=list)
    feedback = Column(JSON, default=list)
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

# Engine and SessionMaker
engine = create_async_engine(DATABASE_URL)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
