const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { clearPid, writePid } = require('./pid-file');

require('./load-env.cjs');

const root = path.resolve(__dirname, '..', '..');

const services = {
  api: {
    portEnv: 'API_PORT',
    port: '3000',
    dist: 'apps/api/dist/main.js',
    src: 'apps/api/src/main.ts',
  },
  media: {
    portEnv: 'MEDIA_PORT',
    port: '3001',
    dist: 'apps/media/dist/main.js',
    src: 'apps/media/src/main.ts',
  },
  transcriber: {
    portEnv: 'TRANSCRIBER_PORT',
    port: '3002',
    dist: 'apps/transcriber/dist/main.js',
    src: 'apps/transcriber/src/main.ts',
  },
  analyzer: {
    portEnv: 'ANALYZER_PORT',
    port: '3003',
    dist: 'apps/analyzer/dist/main.js',
    src: 'apps/analyzer/src/main.ts',
  },
};

const name = process.argv[2];
const spec = services[name];
if (!spec) {
  console.error('usage: node scripts/local/run-service.js <api|media|transcriber|analyzer> [--dist]');
  process.exit(1);
}

const useDist = process.argv.includes('--dist');
process.env.PORT = process.env[spec.portEnv] || spec.port;
process.env.HOST = '127.0.0.1';

const entry = path.join(root, useDist ? spec.dist : spec.src);
if (!fs.existsSync(entry)) {
  console.error(useDist ? `нет сборки ${spec.dist}. Сначала scripts\\local\\build-apps.cmd` : `нет файла ${spec.src}`);
  process.exit(1);
}

const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!useDist && !fs.existsSync(tsxCli)) {
  console.error('нет tsx. Сначала npm install');
  process.exit(1);
}

const args = useDist ? [entry] : [tsxCli, 'watch', entry];
const child = spawn(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

const pids = [process.pid];
if (child.pid) pids.push(child.pid);
writePid(name, pids);

function clear() {
  clearPid(name, pids);
}

function stop() {
  if (!child.killed) child.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', clear);

child.on('exit', (code, signal) => {
  clear();
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
