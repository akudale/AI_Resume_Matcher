"""
Pip Phonics Tutor server.

Serves the tutor web app and (optionally) an AI "brain" so Pip can answer any
question a child asks and understand free-form requests like
"can we do the snake sound again?".

Run:
    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=...        # optional – without it Pip still works
    python server.py                    # then open http://localhost:8000
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    import anthropic
except ImportError:  # the app still works without the AI brain
    anthropic = None

STATIC_DIR = Path(__file__).parent / "static"
MODEL = os.getenv("PHONICS_MODEL", "claude-haiku-5-5")  # fast model keeps voice chat snappy

client = anthropic.Anthropic() if anthropic and os.getenv("ANTHROPIC_API_KEY") else None

app = FastAPI(title="Pip Phonics Tutor")

SYSTEM_PROMPT = """You are Pip, a cheerful parrot who teaches English phonics to children aged 4 to 5.
Your words are read aloud by a text-to-speech voice to a young child.

How to talk:
- Reply in 1 to 3 very short sentences, using simple words a 4-year-old knows.
- Be warm, playful and encouraging. Never say a child is wrong in a harsh way.
- When you mention a letter sound, write it so it can be spoken, e.g. "s says ssss, like in sun".
- No lists, markdown, links, or long words. At most one emoji.
- Stay safe and age-appropriate. If asked about anything scary, grown-up or unsafe, kindly
  suggest asking a grown-up and steer back to letters and sounds.
- If the question is off-topic, answer it in one tiny sentence, then invite the child back
  to the lesson.

Navigation:
- If the child (or a grown-up) asks to learn a specific sound, letter, level or lesson, or to go
  to an easier or harder lesson, call the go_to_lesson tool with the best lesson number from the
  syllabus below, and also say a short happy line like "Let's go!".
"""

GO_TO_LESSON_TOOL = {
    "name": "go_to_lesson",
    "description": (
        "Move the tutor to a specific lesson in the syllabus. Use when the child or a grown-up asks "
        "to learn or practise a particular sound, letter, level or lesson number."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "lesson_number": {"type": "integer", "description": "1-based lesson number from the syllabus."}
        },
        "required": ["lesson_number"],
    },
}


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=500)
    child_name: str | None = Field(None, max_length=40)
    lesson: dict | None = None
    lessons: list[str] = Field(default_factory=list, max_length=200)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)


class ChatResponse(BaseModel):
    reply: str
    goto: int | None = None


def build_system(req: ChatRequest) -> str:
    parts = [SYSTEM_PROMPT]
    if req.lessons:
        parts.append("Syllabus (lesson number: title):\n" + "\n".join(req.lessons))
    if req.lesson:
        words = ", ".join(req.lesson.get("words", [])[:8])
        parts.append(
            f"The child is on lesson {req.lesson.get('num')}: {req.lesson.get('title')}. "
            f"Focus sound: {req.lesson.get('sound') or 'n/a'}. Words: {words}."
        )
    if req.child_name:
        parts.append(f"The child's name is {req.child_name}.")
    return "\n\n".join(parts)


def build_messages(req: ChatRequest) -> list[dict]:
    msgs: list[dict] = []
    for turn in req.history[-8:]:
        if turn.role not in ("user", "assistant") or not turn.content.strip():
            continue
        if msgs and msgs[-1]["role"] == turn.role:
            msgs[-1]["content"] += "\n" + turn.content
        else:
            msgs.append({"role": turn.role, "content": turn.content})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    if msgs and msgs[-1]["role"] == "user":
        msgs.pop()
    msgs.append({"role": "user", "content": req.message})
    return msgs


@app.get("/api/health")
def health() -> dict:
    return {"ai": client is not None, "model": MODEL if client else None}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if client is None:
        return ChatResponse(reply="Ooh, good question! Let's ask a grown-up. Now, back to our sounds!")
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=300,
            system=build_system(req),
            tools=[GO_TO_LESSON_TOOL],
            messages=build_messages(req),
        )
    except Exception as exc:  # network / API errors must never break the lesson
        print(f"[pip] AI error: {exc}")
        return ChatResponse(reply="Hmm, my thinking cap fell off! Let's keep learning sounds.")

    reply = " ".join(b.text for b in resp.content if b.type == "text").strip()
    goto = None
    for block in resp.content:
        if block.type == "tool_use" and block.name == "go_to_lesson":
            try:
                goto = int(block.input.get("lesson_number"))
            except (TypeError, ValueError):
                goto = None
    if not reply:
        reply = "Let's go!" if goto else "Let's keep learning sounds!"
    return ChatResponse(reply=reply, goto=goto)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
