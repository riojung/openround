-- Flex-mode rounds stay open until the host closes them. Preserve the absence of a deadline
-- in durable evidence rather than synthesizing one from the authored question time limit.
ALTER TABLE question_rounds ALTER COLUMN deadline DROP NOT NULL;
