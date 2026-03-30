import re

def clean_ai_response(text: str) -> str:
    """Standardize AI response clean up."""
    if not text:
        return ""
    # Remove 'text:' or 'speech:' prefixes and potential wrapping brackets
    cleaned = re.sub(r'^(text|speech):\s*\[?', '', text, flags=re.IGNORECASE)
    cleaned = re.sub(r'\]$', '', cleaned)
    return cleaned.strip()
