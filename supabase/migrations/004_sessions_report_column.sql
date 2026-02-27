-- Add post_class_report JSONB column to sessions table
-- This allows storing structured feedback (ratings, comments, skills evaluation) without altering columns for each new metric
ALTER TABLE public.sessions
ADD COLUMN post_class_report JSONB DEFAULT NULL;

-- Example structure:
-- {
--   "rating": 5, // 1 to 5
--   "skills": {
--     "grammar": "Good", // Good, Needs Work, etc.
--     "vocabulary": "Excellent",
--     "fluency": "Good",
--     "pronunciation": "Needs Work"
--   },
--   "teacher_comments": "Great class, but needs to review past tense irregular verbs.",
--   "homework_drive_url": "https://..." // Handled by Drive API directly
-- }
