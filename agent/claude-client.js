/**
 * Claude API client wrapper with tool use for client registration.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt, REGISTER_CLIENT_TOOL } = require('./system-prompt');

let client = null;

function initClient(apiKey) {
  if (!apiKey) throw new Error('Claude API key is required');
  client = new Anthropic({ apiKey });
}

/**
 * Send a message to Claude and get a response.
 * @param {Array} conversationHistory - Array of { role, content } messages
 * @param {Object} liveData - { options, activities } from db for live knowledge base
 * @returns {{ text: string, toolCall: object|null }} - AI response + optional tool call
 */
async function chat(conversationHistory, liveData) {
  if (!client) throw new Error('Claude client not initialized. Call initClient(apiKey) first.');

  const systemPrompt = buildSystemPrompt(
    liveData?.options || null,
    liveData?.activities || null
  );

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: systemPrompt,
    tools: [REGISTER_CLIENT_TOOL],
    messages: conversationHistory
  });

  let text = '';
  let toolCall = null;

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCall = { id: block.id, name: block.name, input: block.input };
    }
  }

  // If Claude wants to use a tool, we need to send the tool result back
  if (toolCall && response.stop_reason === 'tool_use') {
    return { text, toolCall, needsToolResult: true, rawResponse: response };
  }

  return { text, toolCall: null, needsToolResult: false };
}

/**
 * Send a tool result back to Claude to get the final text response.
 * @param {Array} conversationHistory - Full history including the assistant tool_use + user tool_result
 * @param {Object} liveData - { options, activities }
 * @returns {{ text: string }}
 */
async function sendToolResult(conversationHistory, liveData) {
  const systemPrompt = buildSystemPrompt(
    liveData?.options || null,
    liveData?.activities || null
  );

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: systemPrompt,
    tools: [REGISTER_CLIENT_TOOL],
    messages: conversationHistory
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }
  return { text };
}

module.exports = { initClient, chat, sendToolResult };
