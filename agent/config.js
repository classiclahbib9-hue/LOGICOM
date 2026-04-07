/**
 * Centralized config for the AI agent.
 * Stored in Electron userData alongside telegram-config.json.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILE = 'agent-config.json';

const DEFAULTS = {
  claudeApiKey: '',
  whatsappEnabled: false,
  telegramAiEnabled: true,  // use AI for telegram (vs old wizard)
};

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function loadConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...DEFAULTS, ...data };
    } catch (e) {
      console.error('Error reading agent config:', e);
    }
  }
  return { ...DEFAULTS };
}

function saveConfig(config) {
  const configPath = getConfigPath();
  const tmpPath = configPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    console.error('Failed to save agent config:', err);
    try { fs.unlinkSync(tmpPath); } catch (e) {}
    throw err;
  }
}

function updateConfig(partial) {
  const current = loadConfig();
  const updated = { ...current, ...partial };
  saveConfig(updated);
  return updated;
}

module.exports = { loadConfig, saveConfig, updateConfig };
