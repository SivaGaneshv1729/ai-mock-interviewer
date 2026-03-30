import aiohttp
from .base import clean_ai_response

class GroqClient:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        self.url = "https://api.groq.com/openai/v1/chat/completions"

    async def get_completion(self, session: aiohttp.ClientSession, prompt: str) -> str:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}]
        }
        
        async with session.post(self.url, headers=headers, json=payload) as response:
            if response.status != 200:
                text = await response.text()
                raise Exception(f"Groq API Error {response.status}: {text}")
            data = await response.json()
            res = data["choices"][0]["message"]["content"]
            return clean_ai_response(res)
