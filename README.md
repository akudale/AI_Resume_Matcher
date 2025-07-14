# AI Resume Matcher

## Brief Intro

The AI Resume Matcher is a tool that helps you match resumes with a job description. It uses AI to extract skills from both the job description and the resumes, and then calculates a matching score for each resume.

## Tech Stack

- **Backend:** FastAPI, Python
- **Frontend:** React, JavaScript
- **AI:** OpenAI/DeepSkeek

## Features

- Paste a job description into a text area.
- Upload one or more resumes.
- View the matching score for each resume.
- See a detailed breakdown of the skills extracted from the job description and each resume, as well as the skills that match.
  

## How to Run

### Prerequisites

- Python 3.7+
- Node.js and npm

### Backend Setup

1.  Navigate to the `backend` directory:
    ```bash
    cd backend
    ```
2.  Install the required Python packages:
    ```bash
    pip install -r requirements.txt
    ```
3.  Create a `.env` file and add your OpenAI API key:
    ```
    OPENAI_API_KEY=your_api_key
    ```
4.  Start the backend server:
    ```bash
    uvicorn main:app --reload
    ```

### Frontend Setup

1.  Navigate to the `frontend` directory:
    ```bash
    cd frontend
    ```
2.  Install the required Node.js packages:
    ```bash
    npm install
    ```
3.  Start the frontend development server:
    ```bash
    npm start
    ```

The application will be available at `http://localhost:3000`.
