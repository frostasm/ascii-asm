import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { remark } from 'remark';
import { visit } from 'unist-util-visit';
import type { Root, Heading, Text } from 'mdast';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// ── Spec extraction ──────────────────────────────────────────────────────────
// AGENTS.md is the single source of truth. The plugin extracts Part 2
// (Language Specification) and writes it to docs/en/language-specification.md
// before Vite starts bundling — both in `vite build` and `vite dev`.
// remark parses into an AST so code blocks containing "# Part N" are never
// mistaken for section headings.

const AGENTS_PATH = resolve(__dirname, 'AGENTS.md');
const SPEC_OUT    = resolve(__dirname, 'docs/en/language-specification.md');

function extractSpec(): void {
  const source = readFileSync(AGENTS_PATH, 'utf-8');
  const processor = remark();
  const tree = processor.parse(source) as Root;

  // Locate "# Part 2 —" heading and the following "# Part N —" heading in the AST
  let startIdx = -1;
  let endIdx   = tree.children.length;

  tree.children.forEach((node, i) => {
    if (node.type !== 'heading' || (node as Heading).depth !== 1) return;
    const text = (node as Heading).children
      .filter((c): c is Text => c.type === 'text')
      .map(c => c.value)
      .join('');
    if (startIdx === -1 && text.startsWith('Part 2 \u2014')) {
      startIdx = i;
    } else if (startIdx !== -1 && endIdx === tree.children.length && /^Part \d+ \u2014/.test(text)) {
      endIdx = i;
    }
  });

  if (startIdx === -1)
    throw new Error('[extract-spec] "# Part 2 \u2014" section not found in AGENTS.md');

  // Strip organizational prefix: "Part 2 — Foo" → "Foo"
  const heading = tree.children[startIdx] as Heading;
  const firstText = heading.children.find((c): c is Text => c.type === 'text');
  if (firstText) firstText.value = firstText.value.replace(/^Part \d+ \u2014 /, '');

  tree.children = tree.children.slice(startIdx, endIdx);

  mkdirSync(resolve(__dirname, 'docs/en'), { recursive: true });
  writeFileSync(SPEC_OUT, processor.stringify(tree), 'utf-8');
  console.log('[extract-spec] docs/en/language-specification.md updated');
}

function extractSpecPlugin(): Plugin {
  return {
    name: 'extract-spec',
    // Runs before bundling in both `vite build` and `vite dev`
    buildStart() {
      extractSpec();
    },
    // In dev mode: watch AGENTS.md and regenerate on save
    configureServer(server) {
      server.watcher.add(AGENTS_PATH);
      server.watcher.on('change', (changedPath) => {
        if (changedPath === AGENTS_PATH) {
          extractSpec();
        }
      });
    },
  };
}

export default defineConfig({
  base: '/ascii-asm/',
  plugins: [extractSpecPlugin(), vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@editor': resolve(__dirname, 'src/editor'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
  build: {
    target: 'es2022',
  },
});
