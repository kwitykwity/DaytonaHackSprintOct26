"""
Reader models for Memory Owl feature
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class PreviousSession(BaseModel):
    """Previous reading session data"""
    last_story: Optional[str] = Field(None, description="Snippet from previous story")
    last_word: Optional[str] = Field(None, description="Practice word from previous session")
    last_seen: Optional[str] = Field(None, description="ISO timestamp of last session")


class ReaderSessionRequest(BaseModel):
    """Request to create or update a reader session"""
    name: str = Field(..., min_length=2, max_length=50, description="Reader's name")
    story_snippet: Optional[str] = Field(None, description="First 50 chars of current story")
    practice_word: Optional[str] = Field(None, description="Word from comprehension check")


class ReaderSessionResponse(BaseModel):
    """Response with reader data and previous session"""
    reader_id: str = Field(..., description="Unique reader identifier")
    name: str = Field(..., description="Reader's name")
    is_returning: bool = Field(..., description="True if reader has previous sessions")
    previous_session: Optional[PreviousSession] = Field(None, description="Data from previous session")
