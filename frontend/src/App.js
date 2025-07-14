import React, { useState } from 'react';
import './App.css';

function App() {
  const [jobDescription, setJobDescription] = useState('');
  const [resumes, setResumes] = useState([]);
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleJobDescriptionChange = (event) => {
    setJobDescription(event.target.value);
  };

  const handleResumeChange = (event) => {
    setResumes(event.target.files);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    const formData = new FormData();
    formData.append('job_description', jobDescription);

    for (let i = 0; i < resumes.length; i++) {
      formData.append('resumes', resumes[i]);
    }

    try {
      const response = await fetch('http://localhost:8000/match', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      setResults(data.results);
    } catch (error) {
      console.error('Error:', error);
    } finally{
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>AI Resume Matcher</h1>
      </header>
      <main>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="job-description">Job Description</label>
            <textarea
              id="job-description"
              value={jobDescription}
              onChange={handleJobDescriptionChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="resumes">Resumes</label>
            <input
              type="file"
              id="resumes"
              multiple
              onChange={handleResumeChange}
              required
            />
          </div>
          <button type="submit">Match Resumes</button>
        </form>
        {isLoading && <div>Loading...</div>}
        {results.length > 0 && !isLoading && (
          <div className="results">
            <h2>Matching Results</h2>
            <ul>
              {results.map((result, index) => (
                <li key={index}>
                  <h3>{result.filename}</h3>
                  <p><strong>Matching Score:</strong> {Math.round(result.score * 100)}%</p>
                  <div>
                    <h4>Matching Skills</h4>
                    <p><strong>Hard Skills:</strong> {result.matching_skills.hard_skills.join(', ')}</p>
                    <p><strong>Soft Skills:</strong> {result.matching_skills.soft_skills.join(', ')}</p>
                  </div>
                  <div>
                    <h4>Job Description Skills</h4>
                    <p><strong>Hard Skills:</strong> {result.job_description_skills.hard_skills.join(', ')}</p>
                    <p><strong>Soft Skills:</strong> {result.job_description_skills.soft_skills.join(', ')}</p>
                  </div>
                  <div>
                    <h4>Resume Skills</h4>
                    <p><strong>Hard Skills:</strong> {result.resume_skills.hard_skills.join(', ')}</p>
                    <p><strong>Soft Skills:</strong> {result.resume_skills.soft_skills.join(', ')}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;