SCORING_PROMPT = """You are a strict, professional interview evaluator. Analyse EVERY question-answer pair in this transcript carefully.

Domain: {domain}

Transcript:
{context}

Evaluate exactly five key dimensions based on evidence:

- technical (0-100): Domain accuracy. Did they mention specific facts/tools/{domain} concepts? Penalise generic answers.
- problem_solving (0-100): Analytical approach. Did they structure their thoughts or consider edge cases?
- communication (0-100): Articulation and structure. Was the tone professional and the pacing clear?
- clarity (0-100): Precision. Did they answer the specific question asked without rambling?
- confidence (0-100): Committing to answers. Penalise excessive hedging (e.g. "maybe", "I guess").

- overall (0-100): Weighted blend — technical 30%, problem_solving 20%, communication 20%, clarity 15%, confidence 15%.

Return ONLY a valid JSON object — no markdown, no explanation:
{{
  "overall": <integer 0-100>,
  "technical": <integer 0-100>,
  "problem_solving": <integer 0-100>,
  "communication": <integer 0-100>,
  "clarity": <integer 0-100>,
  "confidence": <integer 0-100>,
  "strengths": ["<evidence-based strength>", "<evidence-based strength>"],
  "improvements": ["<evidence-based improvement>", "<evidence-based improvement>"]
}}"""
