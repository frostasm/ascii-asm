<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { marked } from 'marked';
// Vite raw import — no additional plugin needed
import specRaw from '../AsciiAsmSpecification.md?raw';

const emit = defineEmits<{ (e: 'close'): void }>();

const html = computed(() => marked.parse(specRaw) as string);

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
    <div class="help-modal" role="dialog" aria-modal="true" aria-label="Language Specification">
      <div class="help-modal-header">
        <span class="help-modal-title">
          <span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">help</span>
          AsciiAsm Language Specification
        </span>
        <button class="help-close-btn" @click="emit('close')" title="Close (Esc)">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="help-modal-body">
        <div class="help-markdown" v-html="html"></div>
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
</style>
