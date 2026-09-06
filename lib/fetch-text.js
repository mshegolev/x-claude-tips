// Скачивание текстового источника. Прокси НЕ используется: code.claude.com и
// raw.githubusercontent.com достижимы напрямую, в отличие от x.com.
import { execFileSync } from 'node:child_process';

export function fetchText(url, timeoutSec = 30) {
  try {
    return execFileSync('curl', [
      '-sSL', '--noproxy', '*', '--max-time', String(timeoutSec),
      '--fail', url,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`fetch failed for ${url}: ${err.message.trim()}`);
  }
}
