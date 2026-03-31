SCORING_PROMPT = """You are a strict interview evaluator. Analyse EVERY question-answer pair in this transcript carefully.

Domain: {domain}

Transcript:
{context}

Evaluate each dimension based strictly on evidence from the answers above:

- communication (0-100): Was the candidate clear, structured, and articulate? Penalise vague, one-word, or rambling answers.
- technical (0-100): Were domain-specific facts, tools, or concepts mentioned correctly? Penalise generic answers with no technical depth.
- confidence (0-100): Did the candidate commit to answers without excessive hedging ("I think maybe…")? Penalise uncertainty or incomplete answers.
- overall (0-100): Weighted blend — technical 40%, communication 35%, confidence 25%.

Strengths and improvements must cite SPECIFIC answers from the transcript (e.g. "In answer 2, the candidate correctly described…").

Return ONLY a valid JSON object — no markdown, no explanation:
{{
  "overall": <integer 0-100>,
  "communication": <integer 0-100>,
  "technical": <integer 0-100>,
  "confidence": <integer 0-100>,
  "strengths": ["<evidence-based strength>", "<evidence-based strength>"],
  "improvements": ["<evidence-based improvement>", "<evidence-based improvement>"]
}}"""
