CREATE TABLE IF NOT EXISTS spam_logs (
    id SERIAL PRIMARY KEY,
    email_snippet TEXT,
    prediction VARCHAR(10),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);