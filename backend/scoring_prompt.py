SCORING_PROMPT = """You are an expert interview evaluator. Analyse the complete interview transcript below and return a structured JSON performance score.

Domain: {domain}
Interview Transcript:
{context}

Return ONLY a valid JSON object with exactly this structure (no markdown, no explanation):
{{
  "overall": <0-100 integer>,
  "communication": <0-100 integer>,
  "technical": <0-100 integer>,
  "confidence": <0-100 integer>,
  "strengths": ["<specific strength 1>", "<specific strength 2>", "<specific strength 3>"],
  "improvements": ["<specific area 1>", "<specific area 2>", "<specific area 3>"]
}}

Scoring rubric:
- overall: Weighted average of all dimensions
- communication: Clarity, structure, articulation of answers
- technical: Accuracy and depth of domain-specific knowledge
- confidence: Assertiveness, completeness, lack of hedging

Base scores strictly on evidence from the transcript. Be honest and specific."""
