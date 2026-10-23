const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureEnvFile() {
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) return;
  const example = path.join(root, '.env.example');
  if (!fs.existsSync(example)) fail('нет .env.example');
  fs.copyFileSync(example, envFile);
  console.log('скопирован .env.example -> .env');
}

function positiveInt(name, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`${name} must be a positive integer`);
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function request(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        finish({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', () => finish(null));
    });
    req.setTimeout(2000, () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function isThisWeb(response) {
  return Boolean(response && response.status === 200 && response.body.includes('<title>Call Analytics</title>'));
}

function isThisApi(response) {
  return Boolean(response && response.status === 200 && response.body.trim() === 'ok');
}

async function main() {
  ensureEnvFile();
  require('./load-env.cjs');

  const webPort = positiveInt('WEB_PORT', process.env.WEB_PORT || '3100');
  const apiPort = positiveInt('API_PORT', process.env.API_PORT || '3000');
  const mediaPort = positiveInt('MEDIA_PORT', process.env.MEDIA_PORT || '3001');
  const transcriberPort = positiveInt('TRANSCRIBER_PORT', process.env.TRANSCRIBER_PORT || '3002');
  const analyzerPort = positiveInt('ANALYZER_PORT', process.env.ANALYZER_PORT || '3003');
  const webUrl = `http://127.0.0.1:${webPort}/`;
  const healthUrl = `http://127.0.0.1:${apiPort}/health`;

  const web = await request(webUrl);
  const health = await request(healthUrl);
  if (isThisWeb(web) && isThisApi(health)) {
    console.log(`уже запущено: ${webUrl} и ${healthUrl}`);
    process.exit(0);
  }

  const listeners = [
    ['WEB_PORT', webPort],
    ['API_PORT', apiPort],
    ['MEDIA_PORT', mediaPort],
    ['TRANSCRIBER_PORT', transcriberPort],
    ['ANALYZER_PORT', analyzerPort],
  ];
  const busy = [];
  for (const [name, port] of listeners) {
    if (await portOpen(port)) busy.push(`${name}=${port}`);
  }
  if (busy.length > 0) {
    fail(`Порты заняты (${busy.join(', ')}). Второй экземпляр не запускаю.`);
  }

  if (fs.existsSync(path.join(root, 'node_modules'))) {
    console.log('node_modules уже есть, npm install пропущен');
  } else {
    run('npm', ['install'], { shell: true });
  }

  run('npm', ['run', 'db:up'], { shell: true });
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'scripts\\local\\build-apps.cmd']);
  run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'scripts\\local\\start-apps.cmd']);
  run('npm', ['run', 'dev:web'], { shell: true });
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
