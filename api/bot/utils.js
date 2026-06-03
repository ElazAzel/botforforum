const axios = require('axios');
const db = require('../db');

// Graceful registration logic: ensures database records exist without resetting user state
async function registerUser(tgId, username) {
  await db.saveUser(tgId, username);
}

// Evaluate user input using Gemini API as Interviewer-Agent with rate-limit retries
async function evaluateInsight(userInput, sessionTitle) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not defined.');
  }

  const systemInstructionText = `You are the Interviewer-Agent of the Meta-Harness system.
Your goal is to validate the insights submitted by conference participants for the session titled: "${sessionTitle}".

Analyze the participant's message.
Criteria:
- The insight must be meaningful, specific, and related to the presentation or topic of the session.
- Reject trivial or one-word messages like "ok", "cool", "normal", "good", "yes", "thanks", "interesting", etc.
- Reject gibberish or spam.

Response format:
You MUST respond with a JSON object:
{
  "is_valid": true/false,
  "clean_insight": "A polished, clean, and grammatically correct version of the insight in Russian",
  "feedback": "If is_valid is false, write a polite, short message in Russian asking the user to expand or clarify. If is_valid is true, leave this empty."
}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `System instructions:\n${systemInstructionText}\n\nParticipant message: "${userInput}"`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2
    }
  };

  const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  let retries = 3;
  let delay = 1000;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error('Empty response from Gemini API');
      }

      let cleaned = responseText.trim();
      const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        cleaned = jsonMatch[1].trim();
      }
      return JSON.parse(cleaned);
    } catch (error) {
      const status = error.response?.status;
      if (status === 429 && i < retries - 1) {
        console.warn(`Gemini 429 rate limit hit. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        console.error('Error calling Gemini API:', error.message);
        if (i === retries - 1) {
          throw error;
        }
      }
    }
  }
}

module.exports = {
  registerUser,
  evaluateInsight
};
