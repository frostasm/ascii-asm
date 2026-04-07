<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { marked } from 'marked';
// Vite raw import — no additional plugin needed
import specRaw from '../AsciiAsmSpecification.md?raw';

const emit = defineEmits<{ (e: 'close'): void }>();

const activeTab = ref<'spec' | 'ascii'>('spec');

const html = computed(() => marked.parse(specRaw) as string);

// ── ASCII table data (printable range 32–126) ─────────────
type AsciiCategory = 'space' | 'digit' | 'upper' | 'lower' | 'symbol';

interface AsciiEntry {
  dec: number;
  hex: string;
  char: string;
  label: string;
  category: AsciiCategory;
  title: string;
}

const SYMBOL_NAMES: Record<number, string> = {
  32: 'Space', 33: 'Exclamation', 34: 'Double quote', 35: 'Hash',
  36: 'Dollar', 37: 'Percent', 38: 'Ampersand', 39: 'Single quote',
  40: 'Left paren', 41: 'Right paren', 42: 'Asterisk', 43: 'Plus',
  44: 'Comma', 45: 'Minus', 46: 'Period', 47: 'Slash',
  58: 'Colon', 59: 'Semicolon', 60: 'Less than', 61: 'Equals',
  62: 'Greater than', 63: 'Question', 64: 'At sign',
  91: 'Left bracket', 92: 'Backslash', 93: 'Right bracket',
  94: 'Caret', 95: 'Underscore', 96: 'Backtick',
  123: 'Left brace', 124: 'Pipe', 125: 'Right brace', 126: 'Tilde',
};

const asciiEntries = computed<AsciiEntry[]>(() => {
  const entries: AsciiEntry[] = [];
  for (let i = 32; i <= 126; i++) {
    const char = String.fromCharCode(i);
    let label = char;
    let category: AsciiCategory = 'symbol';
    if (i === 32)              { label = 'SP';  category = 'space';  }
    else if (i >= 48 && i <= 57)  category = 'digit';
    else if (i >= 65 && i <= 90)  category = 'upper';
    else if (i >= 97 && i <= 122) category = 'lower';
    const name = SYMBOL_NAMES[i];
    const title = name
      ? `${name} — dec ${i}, hex 0x${i.toString(16).toUpperCase().padStart(2,'0')}`
      : `dec ${i}, hex 0x${i.toString(16).toUpperCase().padStart(2,'0')}`;
    entries.push({ dec: i, hex: i.toString(16).padStart(2,'0').toUpperCase(), char, label, category, title });
  }
  return entries;
});

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

onMounted(() => document.addEventListener('keydown', handleKey));
onUnmounted(() => document.removeEventListener('keydown', handleKey));
</script>

<template>
  <div class="help-overlay" @click.self="emit('close')">
    <div class="help-modal" role="dialog" aria-modal="true" aria-label="Help">
      <!-- Header -->
      <div class="help-modal-header">
        <span class="help-modal-title">
          <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">help</span>
          AsciiAsm Help
        </span>
        <button class="help-close-btn" @click="emit('close')" title="Close (Esc)">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- Tabs -->
      <div class="help-tabs">
        <button
          class="help-tab"
          :class="{ active: activeTab === 'spec' }"
          @click="activeTab = 'spec'"
        >
          <span class="material-symbols-outlined" style="font-size:15px;">menu_book</span>
          Language Spec
        </button>
        <button
          class="help-tab"
          :class="{ active: activeTab === 'ascii' }"
          @click="activeTab = 'ascii'"
        >
          <span class="material-symbols-outlined" style="font-size:15px;">table_chart</span>
          ASCII Table
        </button>
      </div>

      <!-- Body -->
      <div class="help-modal-body">
        <!-- Language Spec tab -->
        <div v-if="activeTab === 'spec'" class="help-markdown" v-html="html"></div>

        <!-- ASCII Table tab -->
        <div v-else class="ascii-tab">
          <p class="ascii-intro">
            Printable ASCII characters (codes 32–126). These are the valid values for
            <code>CHAR</code> type in AsciiAsm. Hover a card for the character name.
          </p>

          <!-- Legend -->
          <div class="ascii-legend">
            <span class="ascii-legend-item"><span class="swatch swatch-space"></span>Space</span>
            <span class="ascii-legend-item"><span class="swatch swatch-digit"></span>Digits 0–9</span>
            <span class="ascii-legend-item"><span class="swatch swatch-upper"></span>Uppercase A–Z</span>
            <span class="ascii-legend-item"><span class="swatch swatch-lower"></span>Lowercase a–z</span>
            <span class="ascii-legend-item"><span class="swatch swatch-symbol"></span>Symbols</span>
          </div>

          <!-- Grid -->
          <div class="ascii-grid">
            <div
              v-for="entry in asciiEntries"
              :key="entry.dec"
              class="ascii-card"
              :class="`ascii-${entry.category}`"
              :title="entry.title"
            >
              <div class="ascii-char">{{ entry.label }}</div>
              <div class="ascii-dec">{{ entry.dec }}</div>
              <div class="ascii-hex">0x{{ entry.hex }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  overflow-y: auto;
}

.help-modal {
  background: var(--ide-panel-bg);
  border: 1px solid var(--ide-border);
  border-radius: 8px;
  width: 100%;
  max-width: 1000px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 80px);
  box-shadow: 0 8px 40px rgba(0,0,0,0.5);
}

.help-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ide-border);
  flex-shrink: 0;
}

.help-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ide-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.help-close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--ide-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 4px;
  line-height: 1;
}

.help-close-btn:hover {
  background: var(--ide-bg);
  color: var(--ide-text);
}

/* ── Tabs ────────────────────────────────────────────────── */
.help-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 12px 0;
  border-bottom: 1px solid var(--ide-border);
  flex-shrink: 0;
  background: var(--ide-panel-bg);
}

.help-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ide-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 5px 5px 0 0;
  cursor: pointer;
  position: relative;
  bottom: -1px;
  transition: color 0.15s, background 0.15s;
}

.help-tab:hover {
  color: var(--ide-text);
  background: var(--ide-bg);
}

.help-tab.active {
  color: var(--ide-text);
  background: var(--ide-panel-bg);
  border-color: var(--ide-border);
  border-bottom-color: var(--ide-panel-bg);
  font-weight: 600;
}

/* ── Body ────────────────────────────────────────────────── */
.help-modal-body {
  overflow-y: auto;
  padding: 20px 24px;
  flex: 1;
}

/* ── Markdown content styles ─────────────────────────── */
.help-markdown {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--ide-text);
}

.help-markdown :deep(h1) {
  font-size: 1.5em;
  font-weight: 700;
  margin: 0 0 0.6em;
  color: var(--ide-text);
}

.help-markdown :deep(h2) {
  font-size: 1.2em;
  font-weight: 600;
  margin: 1.4em 0 0.5em;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--ide-border);
  color: var(--ide-text);
}

.help-markdown :deep(h3) {
  font-size: 1em;
  font-weight: 600;
  margin: 1em 0 0.4em;
  color: var(--ide-accent);
}

.help-markdown :deep(p) {
  margin: 0.5em 0;
}

.help-markdown :deep(code) {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.88em;
  background: var(--ide-bg);
  color: var(--ide-warning);
  padding: 1px 5px;
  border-radius: 3px;
}

.help-markdown :deep(pre) {
  background: var(--ide-bg);
  border: 1px solid var(--ide-border);
  border-radius: 5px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0.8em 0;
}

.help-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
  color: var(--ide-text);
  font-size: 0.87em;
}

.help-markdown :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 0.92em;
}

.help-markdown :deep(th),
.help-markdown :deep(td) {
  border: 1px solid var(--ide-border);
  padding: 6px 10px;
  text-align: left;
}

.help-markdown :deep(th) {
  background: var(--ide-bg);
  font-weight: 600;
}

.help-markdown :deep(blockquote) {
  border-left: 3px solid var(--ide-accent);
  margin: 0.8em 0;
  padding: 4px 12px;
  color: var(--ide-text-muted);
  background: var(--ide-bg);
  border-radius: 0 4px 4px 0;
}

.help-markdown :deep(ul),
.help-markdown :deep(ol) {
  padding-left: 1.4em;
  margin: 0.4em 0;
}

.help-markdown :deep(li) {
  margin: 0.25em 0;
}

.help-markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--ide-border);
  margin: 1.2em 0;
}

.help-markdown :deep(strong) {
  color: var(--ide-text);
}

/* ── ASCII Table tab ─────────────────────────────────────── */
.ascii-tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ascii-intro {
  font-size: 13px;
  color: var(--ide-text-muted);
  margin: 0;
  line-height: 1.6;
}

.ascii-intro code {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
  background: var(--ide-bg);
  color: var(--ide-warning);
  padding: 1px 5px;
  border-radius: 3px;
}

/* Legend */
.ascii-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  font-size: 12px;
  color: var(--ide-text-muted);
}

.ascii-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.1);
}

.swatch-space  { background: #5a5a6a; }
.swatch-digit  { background: #1a6a8a; }
.swatch-upper  { background: #1a6a3a; }
.swatch-lower  { background: #7a5a10; }
.swatch-symbol { background: transparent; border-color: var(--ide-border); }

/* Grid */
.ascii-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
}

.ascii-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 7px 4px 5px;
  border-radius: 6px;
  border: 1px solid var(--ide-border);
  background: var(--ide-bg);
  cursor: default;
  transition: transform 0.1s, box-shadow 0.1s;
  user-select: none;
}

.ascii-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  z-index: 1;
}

/* Category tints */
.ascii-space  { border-color: #5a5a6a; background: #2a2a36; }
.ascii-digit  { border-color: #1e5e7a; background: #0d2f3d; }
.ascii-upper  { border-color: #1e5e38; background: #0b2d1d; }
.ascii-lower  { border-color: #6a4a0e; background: #352208; }
.ascii-symbol { border-color: var(--ide-border); }

.ascii-char {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ide-text);
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ascii-space .ascii-char  { color: #9a9aaa; font-size: 13px; font-weight: 700; letter-spacing: 0.03em; }
.ascii-digit .ascii-char  { color: #4ec9b0; }
.ascii-upper .ascii-char  { color: #6ab04c; }
.ascii-lower .ascii-char  { color: #dcdcaa; }
.ascii-symbol .ascii-char { color: #c586c0; }

.ascii-dec,
.ascii-hex {
  font-size: 10px;
  color: var(--ide-text-muted);
  line-height: 1.3;
}

.ascii-dec {
  font-weight: 600;
  color: var(--ide-text);
  font-size: 11px;
}
</style>
