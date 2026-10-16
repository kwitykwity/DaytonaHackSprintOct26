import os
import json
import logging
import asyncio
from anthropic import AsyncAnthropic
from app.models.scene import SceneResponse

logger = logging.getLogger(__name__)


def get_client():
    api_key = (
        os.getenv("API_KEY")
        or os.getenv("ANTHROPIC_API_KEY")
        or os.getenv("ANTHROPIC_API_KEY")
    )
    if not api_key:
        logger.error("Anthropic API key not configured (API_KEY or ANTHROPIC_API_KEY)")
        raise ValueError("Anthropic API key not configured")
    logger.debug("Anthropic client initialized")
    return AsyncAnthropic(api_key=api_key)

CONTENT_SAFETY_STRICT = """CONTENT SAFETY (highest priority — the result is narrated aloud to young children):
The audience is children in grades 1-3. Apply a STRICT standard:
- BLOCK any content containing: death, killing, violence, weapons, scary situations, villains, predators, conflict, sadness, fear, or any mature themes.
- Only allow purely positive, happy, and gentle stories with no conflict or tension.
- If the story contains ANY of the above themes, do NOT produce scenes. Instead return the blocked response below."""

CONTENT_SAFETY_MODERATE = """CONTENT SAFETY (highest priority — the result is narrated aloud to young children):
The audience is children in grades 1-3. Many classic stories (e.g. Aesop's fables) carry good morals but contain mature details — death, killing, violence, cruelty, or evil. Apply a MODERATE standard:
- SOFTEN salvageable content: gently rewrite mature moments into age-appropriate outcomes while preserving the story's arc and its moral. For example, a character who dies "goes away" or "is never seen again"; a predator "chases off" or "scares" rather than kills or eats; violence becomes a narrow escape or a lesson learned. Mild peril or sadness is fine when it resolves positively.
- Keep the moral and the shape of the story intact — adapt wording, don't invent a different story.
- BLOCK truly unsuitable input: if a story is fundamentally inappropriate for young children (graphic or gory violence, cruelty or torture, sexual content, hate, or self-harm) and cannot be faithfully softened while staying true to it, do NOT produce scenes. Instead return the blocked response below."""

CONTENT_SAFETY_ORIGINAL = """CONTENT SAFETY:
Preserve the original story exactly as written. Do not soften, censor, or modify any content.
- Keep all original wording, themes, and events intact.
- Do not block any stories - process all content as-is.
- Note: Image prompts should still be appropriate for illustration (no graphic imagery)."""


def get_system_prompt(content_level: str) -> str:
    """Build the system prompt based on content level."""
    content_safety = {
        "strict": CONTENT_SAFETY_STRICT,
        "moderate": CONTENT_SAFETY_MODERATE,
        "original": CONTENT_SAFETY_ORIGINAL,
    }.get(content_level, CONTENT_SAFETY_MODERATE)

    # NOT an f-string: the prompt embeds literal JSON examples, whose braces an
    # f-string would parse as format expressions (raising ValueError at runtime).
    # The single placeholder is substituted with str.replace, which treats the
    # surrounding braces as plain text.
    return """You are a children's story editor specializing in creating illustrated storybooks for kids in grades 1-3.

Your task is to split a story into exactly 5 scenes suitable for an illustrated presentation. Each scene should be a natural narrative beat, together forming a beginning, middle, and end.

{content_safety}

ENGAGEMENT PROMPTS (for active listening):
To help children become active listeners rather than passive ones, add engagement prompts to 2-3 scenes (NOT the first or last scene). Choose from these types:

1. "sound_cue" (timing: "before") - Tell the child to do something when they hear a word/event
   - Examples: "Clap when you hear the dog bark!", "Wave when Max gets home!"
   - The action must reference something that actually appears in that scene's text

2. "reading_prompt" (timing: "after") - Encourage prediction or thinking
   - Ask "What do you think happens next?" or similar prediction questions
   - Best placed mid-story where there's natural suspense

3. "comprehension_check" (timing: "after") - Ask a WHO/WHAT/WHERE question with a simple noun answer
   - Ask questions that have a single name, object, color, or place as the answer
   - Good questions: "Who helped Max?", "What color was the ball?", "Where did they go?"
   - The answer_hint MUST be exactly 1-2 words: a name ("Lily"), color ("red"), object ("the key"), or place ("the park")
   - NEVER ask questions that require sentence answers like "What happened?" or "Why did he leave?"

You must respond with valid JSON in ONE of these two formats.

If the story is usable (after softening if needed):
{
  "blocked": false,
  "character_description": "A detailed visual description of the main character(s) that can be used consistently across all illustrations. Include physical features, clothing, and distinctive traits.",
  "scenes": [
    {
      "scene_number": 1,
      "text": "The story text for this scene.",
      "image_prompt": "A detailed, child-friendly image prompt for DALL-E 3.",
      "emotion": "happy"
    },
    {
      "scene_number": 2,
      "text": "Max barked loudly at the butterflies...",
      "image_prompt": "...",
      "emotion": "excited",
      "engagement": {
        "type": "sound_cue",
        "timing": "before",
        "text": "Clap your hands when Max barks!"
      }
    },
    {
      "scene_number": 3,
      "text": "...",
      "image_prompt": "...",
      "emotion": "calm",
      "engagement": {
        "type": "reading_prompt",
        "timing": "after",
        "text": "What do you think happens next?"
      }
    },
    {
      "scene_number": 4,
      "text": "Lily helped Max find his way home...",
      "image_prompt": "...",
      "emotion": "happy",
      "engagement": {
        "type": "comprehension_check",
        "timing": "after",
        "text": "Who helped Max find his way?",
        "answer_hint": "Lily"
      }
    },
    {
      "scene_number": 5,
      "text": "...",
      "image_prompt": "...",
      "emotion": "happy"
    }
  ]
}

If the story must be blocked:
{
  "blocked": true,
  "block_reason": "A short, gentle, kid-safe explanation for the grown-up (one or two sentences). Do NOT restate the graphic content; just say it isn't suitable for young readers and suggest trying a gentler story.",
  "character_description": "",
  "scenes": []
}

Guidelines (for the non-blocked case):
- Always produce exactly 5 scenes. Find natural narrative breaks; if the story is short, divide it into finer beats so there are still 5 scenes.
- Preserve the original wording where it is already age-appropriate; only change what the content-safety rule requires. Do not add commentary or invent unrelated events.
- Each part of the (adapted) story should appear in exactly one scene — never repeat, overlap, or duplicate text between scenes. If the story is short, split sentences into smaller phrases to reach 5 scenes rather than repeating any text.
- Character description should be detailed enough for visual consistency across scenes
- Image prompts should be child-friendly, colorful, and suitable for a storybook, and must also respect the content-safety rule (never depict violence, gore, or scary imagery)
- Image prompts should always reference the character's consistent appearance
- Use a warm, friendly illustration style (e.g., "children's book illustration style, warm colors, friendly")
- Tag each scene with an "emotion" that captures its dominant emotional tone. You MUST pick exactly one of: "happy", "sad", "excited", "scared", "calm". This drives a narrator owl's facial expression, so choose the tone a child would feel during that scene.
- Add engagement prompts to 2-3 middle scenes (scenes 2, 3, or 4). Do NOT add prompts to scene 1 or scene 5.
- IMPORTANT: For comprehension_check, only ask WHO/WHAT/WHERE questions that have a simple 1-2 word answer (a name, color, object, or place). Never ask "What happened?" or "Why?" questions.""".replace(
        "{content_safety}", content_safety
    )


async def split_story_into_scenes(story: str, content_level: str = "moderate", timeout_seconds: int = 60) -> SceneResponse:
    logger.info(f"Starting scene splitting. Story length: {len(story)} chars, content_level: {content_level}")

    client = get_client()
    system_prompt = get_system_prompt(content_level)

    try:
        logger.info("Calling Anthropic messages.create API...")
        message = await asyncio.wait_for(
            client.messages.create(
                model="claude-sonnet-5",
                max_tokens=4096,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": f"Please split this story into scenes:\n\n{story}",
                    }
                ],
            ),
            timeout=timeout_seconds
        )
        logger.info("Anthropic API response received")

        # The response may lead with non-text blocks (e.g. a ThinkingBlock when
        # extended thinking is on), so pick the first text block rather than
        # assuming content[0].
        response_text = next(
            (block.text for block in message.content if block.type == "text"),
            None,
        )
        if response_text is None:
            logger.error("No text block in Anthropic response")
            raise ValueError("No text content in scene response from Claude")
        logger.debug(f"Response text length: {len(response_text)} chars")

        # A response cut off at max_tokens yields unterminated JSON. Detect it
        # here so the failure is reported as truncation rather than surfacing as
        # a generic parse error further down.
        truncated = message.stop_reason == "max_tokens"
        if truncated:
            logger.error(
                "Anthropic response hit max_tokens (%s); scene JSON is truncated",
                message.usage.output_tokens if message.usage else "unknown",
            )

        # Parse JSON from response
        try:
            data = json.loads(response_text)
            logger.info("JSON parsed successfully")
        except json.JSONDecodeError as e:
            logger.warning(f"Initial JSON parse failed: {e}. Attempting extraction...")
            # Try to extract JSON from the response if it contains extra text
            start = response_text.find("{")
            end = response_text.rfind("}") + 1
            if start != -1 and end > start:
                # Truncation leaves a trailing "}" from the last complete inner
                # object, so this slice can still be invalid JSON. Without its
                # own guard the retry raises JSONDecodeError from inside this
                # handler, escaping the ValueError contract the API layer maps
                # to a 503 and surfacing as an opaque 500 instead.
                try:
                    data = json.loads(response_text[start:end])
                    logger.info("JSON extracted and parsed successfully")
                except json.JSONDecodeError as extract_error:
                    logger.error(
                        "Failed to parse extracted JSON (%s): %s...",
                        extract_error,
                        response_text[:200],
                    )
                    raise ValueError(
                        "Scene response from Claude was truncated"
                        if truncated
                        else "Failed to parse scene response from Claude"
                    ) from extract_error
            else:
                logger.error(f"Failed to extract JSON from response: {response_text[:200]}...")
                raise ValueError(
                    "Scene response from Claude was truncated"
                    if truncated
                    else "Failed to parse scene response from Claude"
                ) from e

        if data.get("blocked"):
            logger.info("Story blocked by content-safety guardrail")
            return SceneResponse(
                blocked=True,
                block_reason=data.get("block_reason", ""),
            )

        scene_count = len(data.get("scenes", []))
        logger.info(f"Scene splitting complete. Generated {scene_count} scenes")
        return SceneResponse(**data)

    except asyncio.TimeoutError:
        logger.error(f"Scene splitting timed out after {timeout_seconds} seconds")
        raise TimeoutError(f"Scene splitting timed out after {timeout_seconds} seconds")
    except Exception as e:
        logger.error(f"Scene splitting failed: {type(e).__name__}: {str(e)}")
        raise
