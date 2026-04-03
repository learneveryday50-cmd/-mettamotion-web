/**
 * build.mjs
 * Replaces the Tailwind CDN <script> + inline config block in every HTML file
 * with a <link> to the pre-built /assets/styles.css.
 * Run after: npx tailwindcss -i src/input.css -o assets/styles.css --minify
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// All HTML files to patch
const HTML_FILES = [
  'index.html',
  'blog/index.html',
  'blog/post/index.html',
  'blog/ai-agents-era/index.html',
  'blog/ai-content-engine/index.html',
  'blog/ai-small-business/index.html',
  'blog/crm-automation/index.html',
  'blog/email-funnel-ai/index.html',
  'blog/gpt-vs-claude/index.html',
  'blog/make-vs-zapier/index.html',
  'blog/n8n-workflows/index.html',
  'blog/prompt-engineering-dead/index.html',
  'blog/seo-ai-search/index.html',
];

// Matches: <script src="https://cdn.tailwindcss.com"></script>
//          <script>\n    tailwind.config = { ... }\n  </script>
const CDN_PATTERN = /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*\}\s*<\/script>/;

const REPLACEMENT = `<link rel="stylesheet" href="/assets/styles.css" />`;

let updated = 0;
for (const rel of HTML_FILES) {
  const abs = path.join(__dirname, rel);
  if (!fs.existsSync(abs)) { console.log(`Skipped (not found): ${rel}`); continue; }

  const original = fs.readFileSync(abs, 'utf8');
  const patched  = original.replace(CDN_PATTERN, REPLACEMENT);

  if (patched === original) {
    console.log(`Skipped (no CDN found): ${rel}`);
  } else {
    fs.writeFileSync(abs, patched, 'utf8');
    console.log(`Patched: ${rel}`);
    updated++;
  }
}

console.log(`\nDone — ${updated} file(s) updated.`);
