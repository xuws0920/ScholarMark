import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite']);
const TEXT_EXTS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
]);

const decoder = new TextDecoder('utf-8', { fatal: true });
const bad = [];

async function walk(dir) {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        await walk(full);
      }
      continue;
    }

    const ext = extname(entry).toLowerCase();
    if (!TEXT_EXTS.has(ext)) continue;
    await checkFile(full);
  }
}

async function checkFile(file) {
  const buf = await readFile(file);

  // Reject UTF-16 BOM or null-byte heavy files (typically UTF-16 content).
  if (buf.length >= 2) {
    const b0 = buf[0];
    const b1 = buf[1];
    if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
      bad.push(`${rel(file)}: UTF-16 BOM detected`);
      return;
    }
  }

  const nullCount = countByte(buf, 0x00);
  if (nullCount > 0 && nullCount / Math.max(buf.length, 1) > 0.1) {
    bad.push(`${rel(file)}: too many NUL bytes, likely non-UTF-8 text`);
    return;
  }

  try {
    const text = decoder.decode(buf);
    if (text.includes('\uFFFD')) {
      bad.push(`${rel(file)}: replacement character (U+FFFD) found, likely mojibake`);
    }
  } catch (err) {
    bad.push(`${rel(file)}: invalid UTF-8 (${err.message})`);
  }
}

function rel(file) {
  return file.slice(ROOT.length + 1).replace(/\\/g, '/');
}

function countByte(buf, byte) {
  let n = 0;
  for (const b of buf) {
    if (b === byte) n++;
  }
  return n;
}

await walk(ROOT);

if (bad.length) {
  console.error('Encoding check failed. The following files are not clean UTF-8:');
  for (const line of bad) console.error(`- ${line}`);
  process.exit(1);
}

console.log('Encoding check passed: all scanned text files are valid UTF-8.');
