const RENAME_OR_COPY = /[RC]/u;

function displayPath(path: string): string {
  let displayed = '';
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    const shouldEscape =
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    if (!shouldEscape) {
      displayed += character;
      continue;
    }
    switch (character) {
      case '\n':
        displayed += '\\n';
        break;
      case '\r':
        displayed += '\\r';
        break;
      case '\t':
        displayed += '\\t';
        break;
      default:
        displayed +=
          code <= 0xffff ? `\\u${code.toString(16).padStart(4, '0')}` : `\\u{${code.toString(16)}}`;
    }
  }
  return displayed;
}

function malformedStatus(): never {
  throw new Error('Git 返回了无法识别的工作区状态。');
}

/**
 * Parses `git status --porcelain=v1 -z`.
 *
 * The NUL-delimited form keeps Windows paths, Unicode, whitespace and quotes
 * unescaped. Git emits renamed/copied paths as `target\0source\0`, so the
 * display form restores the human-readable `source → target` direction.
 */
export function parsePorcelainV1Z(output: string): string[] {
  if (!output) return [];

  const fields = output.split('\0');
  if (fields.at(-1) !== '') malformedStatus();

  const lines: string[] = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const record = fields[index];
    if (!record || record.length < 4 || record[2] !== ' ') malformedStatus();

    const status = record.slice(0, 2);
    const targetPath = record.slice(3);
    if (!targetPath) malformedStatus();

    if (RENAME_OR_COPY.test(status)) {
      const sourcePath = fields[index + 1];
      if (!sourcePath) malformedStatus();
      index += 1;
      lines.push(`${status} ${displayPath(sourcePath)} → ${displayPath(targetPath)}`);
      continue;
    }

    lines.push(`${status} ${displayPath(targetPath)}`);
  }

  return lines;
}
