from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from google import genai
import markdown2

# Load environment variables
load_dotenv()

app = FastAPI()

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup Gemini Clients
api_key1 = os.getenv("GEMINI_API_KEY1")
api_key2 = os.getenv("GEMINI_API_KEY2")

# Initialize clients only if keys are present
client1 = genai.Client(api_key=api_key1) if api_key1 else None
client2 = genai.Client(api_key=api_key2) if api_key2 else None

class ChatRequest(BaseModel):
    prompt: str

async def generate_reply(prompt: str, client):
    if not client:
        raise Exception("API Key not configured")
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )
    return response.text

@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        # Logic to try client1 then switch to client2 if needed
        try:
            reply_text = await generate_reply(req.prompt, client1)
        except Exception as e1:
            print(f"Client 1 failed: {e1}")
            error_msg = str(e1)
            # Check for 503 (Service Unavailable) or 429 (Resource Exhausted)
            if client2 and ("503" in error_msg or "Service temporarily unavailable" in error_msg or "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg):
                print("Switching to Client 2...")
                try:
                    reply_text = await generate_reply(req.prompt, client2)
                except Exception as e2:
                    print(f"Client 2 failed: {e2}")
                    return {"reply": "Service is currently busy or quota exceeded. Please try again later."}
            else:
                return {"reply": f"Error: {error_msg}"}

        # Markdown formatting is optional but kept for compatibility
        # reply_text = markdown2.markdown(reply_text) 
        return {"reply": reply_text}
    except Exception as e:
        return {"reply": f"Error: {str(e)}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)