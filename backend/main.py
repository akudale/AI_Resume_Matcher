
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import PyPDF2
import io
import openai
import os
from dotenv import load_dotenv
import json
import re

load_dotenv()

app = FastAPI()

# CORS middleware to allow requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


openai.api_key = os.getenv("OPENAI_API_KEY")

client = openai.OpenAI(
    base_url="https://api.deepseek.com",
    api_key=os.getenv("OPENAI_API_KEY")
)

def extract_text_from_pdf(pdf_file: io.BytesIO) -> str:
    pdf_reader = PyPDF2.PdfReader(pdf_file)
    text = ""
    for page in pdf_reader.pages:
        text += page.extract_text()
    return text

async def extract_skills(text: str) -> dict:
    prompt = f"""Extract the hard and soft skills from the following text. 
    Return the skills as a JSON object with two keys: 'hard_skills' and 'soft_skills'.

    Text: {text}
    """

    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": "You are a helpful assistant that extracts skills from text."},
            {"role": "user", "content": prompt}
        ],
        stream=False
    )

    response_content = response.choices[0].message.content
    print(f"LLM Response: {response_content}")
    # Extract the JSON part from the response string
    json_match = re.search(r"\{.*\}", response_content, re.DOTALL)
    if json_match:
        json_str = json_match.group(0)
        return json.loads(json_str)
    else:
        # Handle cases where no JSON is found
        return {"hard_skills": [], "soft_skills": []}


@app.get("/status")
async def get_status():
    return {"status": "running"}


@app.post("/match")
async def match_resumes(job_description: str = Form(...), resumes: list[UploadFile] = File(...)):
    job_desc_skills = await extract_skills(job_description)

    results = []
    for resume in resumes:
        if resume.filename.endswith(".pdf"):
            resume_text = extract_text_from_pdf(io.BytesIO(await resume.read()))
        else:
            resume_text = (await resume.read()).decode("utf-8")

        resume_skills = await extract_skills(resume_text)

        # Combine all skills into a single string for vectorization
        job_desc_hard_skills = set(job_desc_skills.get('hard_skills', []))
        job_desc_soft_skills = set(job_desc_skills.get('soft_skills', []))
        resume_hard_skills = set(resume_skills.get('hard_skills', []))
        resume_soft_skills = set(resume_skills.get('soft_skills', []))

        matching_hard_skills = list(job_desc_hard_skills.intersection(resume_hard_skills))
        matching_soft_skills = list(job_desc_soft_skills.intersection(resume_soft_skills))

        job_desc_all_skills = " ".join(job_desc_skills.get('hard_skills', [])) + " " + " ".join(job_desc_skills.get('soft_skills', []))
        resume_all_skills = " ".join(resume_skills.get('hard_skills', [])) + " " + " ".join(resume_skills.get('soft_skills', []))

        vectorizer = CountVectorizer().fit_transform([job_desc_all_skills, resume_all_skills])
        vectors = vectorizer.toarray()

        cosine_similarities = cosine_similarity([vectors[0]], [vectors[1]]).flatten()

        results.append({
            "filename": resume.filename,
            "score": cosine_similarities[0],
            "job_description_skills": job_desc_skills,
            "resume_skills": resume_skills,
            "matching_skills": {
                "hard_skills": matching_hard_skills,
                "soft_skills": matching_soft_skills
            }
        })

    return {"results": results}
