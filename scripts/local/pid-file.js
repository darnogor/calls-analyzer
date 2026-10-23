const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', '..', '.local', 'pids');

function pidList(pids) {
  const list = Array.isArray(pids) ? pids : [pids];
  return list.filter((pid) => Number.isInteger(pid) && pid > 0);
}

function pidPath(name) {
  return path.join(dir, `${name}.pid`);
}

function writePid(name, pids) {
  const list = pidList(pids);
  if (list.length === 0) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pidPath(name), `${list.join('\n')}\n`);
}

function clearPid(name, pids) {
  const file = pidPath(name);
  try {
    if (!fs.existsSync(file)) return;
    const current = fs.readFileSync(file, 'utf8').trim();
    if (current === pidList(pids).join('\n')) fs.unlinkSync(file);
  } catch {
    // kill-ports.ps1 may already have removed the file.
  }
}

module.exports = { writePid, clearPid };
