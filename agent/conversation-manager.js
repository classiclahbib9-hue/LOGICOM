/**
 * Multi-platform conversation manager.
 * Handles Telegram + WhatsApp sessions, routes through Claude, executes tool calls.
 */

const { initClient, chat, sendToolResult } = require('./claude-client');
const { loadConfig } = require('./config');

// In-memory conversation store: key = "platform:chatId" -> { history: [], lastActive: Date }
const sessions = new Map();
const SESSION_TTL = 60 * 60 * 1000; // 1 hour

// External dependencies injected at init time
let _addClient = null;
let _getClientByPhone = null;
let _getLiveData = null;

/**
 * Initialize the conversation manager.
 * @param {Object} deps - { addClientManually, getClientByPhone, getOptionsAndActivities }
 */
function init(deps) {
  _addClient = deps.addClientManually;
  _getClientByPhone = deps.getClientByPhone;
  _getLiveData = deps.getOptionsAndActivities;

  const config = loadConfig();
  if (config.claudeApiKey) {
    initClient(config.claudeApiKey);
    console.log('AI Agent initialized with Claude API key.');
  } else {
    console.log('AI Agent: No Claude API key configured. Set it in LOGICOM settings.');
  }
}

/**
 * Reinitialize the Claude client (called when API key changes).
 */
function reinit(apiKey) {
  if (apiKey) initClient(apiKey);
}

/**
 * Cleanup expired sessions periodically.
 */
function cleanupSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL) {
      sessions.delete(key);
    }
  }
}
setInterval(cleanupSessions, 5 * 60 * 1000); // every 5 minutes

/**
 * Get or create a session for a platform+chatId pair.
 */
function getSession(platform, chatId) {
  const key = `${platform}:${chatId}`;
  if (!sessions.has(key)) {
    sessions.set(key, { history: [], lastActive: Date.now() });
  }
  const session = sessions.get(key);
  session.lastActive = Date.now();
  return session;
}

/**
 * Process an incoming message from any platform.
 * @param {string} platform - 'telegram' or 'whatsapp'
 * @param {string} chatId - Platform-specific chat identifier
 * @param {string} text - Message text from the client
 * @param {Object} userInfo - { username, firstName, phone }
 * @returns {string} - Response text to send back
 */
async function processMessage(platform, chatId, text, userInfo) {
  const config = loadConfig();
  if (!config.claudeApiKey) {
    return "Merhba! L'assistant automatique mch disponible dork. Envoyez: NOM - TEL - MARQUE pour vous inscrire directement.";
  }

  const session = getSession(platform, chatId);

  // Add user message to history
  session.history.push({ role: 'user', content: text });

  // Keep history manageable (last 20 messages)
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }

  try {
    // Get live data from DB
    const liveData = _getLiveData ? _getLiveData() : null;

    // Send to Claude
    const result = await chat(session.history, liveData);

    if (result.needsToolResult && result.toolCall) {
      // Claude wants to register a client
      const toolResult = await executeToolCall(result.toolCall, platform, userInfo);

      // Add assistant response (with tool use) to history
      session.history.push({ role: 'assistant', content: result.rawResponse.content });

      // Add tool result to history
      session.history.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: result.toolCall.id,
          content: toolResult.message
        }]
      });

      // Get Claude's final response after tool execution
      const finalResult = await sendToolResult(session.history, liveData);
      const finalText = finalResult.text || toolResult.message;

      // Add final assistant response to history
      session.history.push({ role: 'assistant', content: finalText });

      return finalText;
    }

    // Normal text response
    const responseText = result.text;
    session.history.push({ role: 'assistant', content: responseText });
    return responseText;

  } catch (err) {
    console.error(`AI Agent error (${platform}:${chatId}):`, err);

    // Remove failed message from history
    session.history.pop();

    if (err.message?.includes('API key')) {
      return "Erreur de configuration. L'equipe technique va regler ca inchallah.";
    }
    return "Desole, y'a eu un probleme technique. Renvoyez votre message SVP, wla envoyez: NOM - TEL - MARQUE.";
  }
}

/**
 * Execute a tool call (currently only register_client).
 */
async function executeToolCall(toolCall, platform, userInfo) {
  if (toolCall.name === 'register_client') {
    const { name, phone, brand, note } = toolCall.input;
    const addedBy = userInfo?.username || userInfo?.firstName || 'Bot';

    // Check for duplicates
    if (_getClientByPhone) {
      const existing = _getClientByPhone(phone);
      if (existing) {
        return {
          success: false,
          message: `Client deja enregistre avec ce numero (${existing.name}). Pas de doublon.`
        };
      }
    }

    // Register the client
    try {
      const source = platform === 'whatsapp' ? 'WhatsApp Bot' : 'Telegram Bot';
      await _addClient({
        name: name || 'Client',
        phone: phone || '',
        brand: brand || '',
        note: note || '',
        addedBy,
        source
      });
      return {
        success: true,
        message: `Client "${name}" enregistre avec succes! Telephone: ${phone}, Domaine: ${brand || '-'}.`
      };
    } catch (err) {
      console.error('Tool call register_client failed:', err);
      return {
        success: false,
        message: `Erreur lors de l'enregistrement: ${err.message}`
      };
    }
  }

  return { success: false, message: `Outil inconnu: ${toolCall.name}` };
}

module.exports = { init, reinit, processMessage };
