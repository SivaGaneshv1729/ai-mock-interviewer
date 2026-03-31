import asyncio
import os
import sys

# Path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

# Now we can import the backend modules
try:
    from database import init_db, AsyncSessionLocal, InterviewSessionModel
    from interview_manager import InterviewManager
except ImportError:
    # Try alternate path
    sys.path.append(os.path.join(current_dir, "backend"))
    from database import init_db, AsyncSessionLocal, InterviewSessionModel
    from interview_manager import InterviewManager

async def test_db():
    print("Initializing DB...")
    await init_db()
    print("DB Initialized.")
    
    try:
        print("Creating session...")
        session = await InterviewManager.create_session("Test Domain", "groq")
        print(f"Session created with ID: {session.id}")
    except Exception as e:
        print(f"Error during create_session: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_db())
