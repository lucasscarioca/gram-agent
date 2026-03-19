ALTER TABLE chats ADD COLUMN default_vision_model TEXT;
ALTER TABLE chats ADD COLUMN default_transcription_model TEXT;
ALTER TABLE messages ADD COLUMN content_json TEXT;
