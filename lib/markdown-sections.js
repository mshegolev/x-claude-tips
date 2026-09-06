// Разбор markdown на секции второго уровня. Без сети и файлов.

// Заголовок внутри ```-блока не является заголовком секции.
function stripFences(markdown) {
  const out = [];
  let inFence = false;
  for (const line of String(markdown).split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; out.push(''); continue; }
    out.push(inFence ? '' : line);
  }
  return out;
}

export function splitSections(markdown, { minChars = 0 } = {}) {
  const lines = String(markdown).split('\n');
  const masked = stripFences(markdown);
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(masked[i] || '');
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(lines[i]);
  }
  if (current) sections.push(current);
  return sections
    .map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() }))
    .filter((s) => s.text.length >= minChars);
}
