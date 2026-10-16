"""
Example: How to integrate Arize monitoring into scene_service.py

This shows the minimal changes needed to add AI observability.
Copy this pattern to your actual scene_service.py
"""

import time
from app.services.arize_monitor import track_ai_operation, log_scene_generation

# EXAMPLE 1: Using the decorator (automatic tracking)
@track_ai_operation("anthropic", "scene_splitting")
async def split_story_into_scenes(story: str, content_level: str = "moderate"):
    """
    The decorator automatically tracks:
    - Latency
    - Success/failure
    - Errors
    """
    # Your existing code here
    response = await anthropic_client.messages.create(...)
    return parse_response(response)


# EXAMPLE 2: Manual logging (for more control)
async def split_story_into_scenes_manual(story: str, content_level: str = "moderate"):
    """
    Manually log metrics for custom tracking
    """
    start_time = time.time()

    try:
        # Your existing code
        response = await anthropic_client.messages.create(...)
        scenes = parse_response(response)

        # Calculate metrics
        duration_ms = (time.time() - start_time) * 1000

        # Log to Arize
        log_scene_generation(
            story_length=len(story),
            num_scenes=len(scenes.scenes),
            latency_ms=duration_ms,
            blocked=scenes.blocked,
            content_level=content_level
        )

        return scenes

    except Exception as e:
        # Log error
        duration_ms = (time.time() - start_time) * 1000
        log_scene_generation(
            story_length=len(story),
            num_scenes=0,
            latency_ms=duration_ms,
            blocked=False,
            content_level=content_level
        )
        raise


# EXAMPLE 3: Integration in existing scene_service.py
"""
In your actual scene_service.py, just add these lines:

1. At the top:
   from app.services.arize_monitor import log_scene_generation
   import time

2. In split_story_into_scenes function:

   async def split_story_into_scenes(story: str, content_level: str = "moderate"):
       start_time = time.time()  # Add this

       try:
           # ... your existing code ...

           # Before returning, add this:
           log_scene_generation(
               story_length=len(story),
               num_scenes=len(scenes.scenes),
               latency_ms=(time.time() - start_time) * 1000,
               blocked=scenes.blocked,
               content_level=content_level
           )

           return scenes

       except Exception as e:
           # Add logging for errors too
           log_scene_generation(
               story_length=len(story),
               num_scenes=0,
               latency_ms=(time.time() - start_time) * 1000,
               blocked=False,
               content_level=content_level
           )
           raise
"""
