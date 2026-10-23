const fs = require('fs');
const path = require('path');

// Fill unset variables from repo-root .env, or from .env.example when .env is absent.
// Existing variables stay as they are, so a caller can still override a single value.
function loadRepoEnv() {
  const root = path.resolve(__dirname, '..', '..');
  const envFile = path.join(root, '.env');
  const exampleFile = path.join(root, '.env.example');
  const file = fs.existsSync(envFile) ? envFile : fs.existsSync(exampleFile) ? exampleFile : '';
  if (!file) return;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadRepoEnv();

module.exports = { loadRepoEnv };
