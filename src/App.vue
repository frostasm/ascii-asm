<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useAppStore } from './composables/useAppStore';
import { useTheme } from './composables/useTheme';
import { useFileStore } from './composables/useFileStore';
import HelpModal from './HelpModal.vue';
import { formatRegisterValue, formatRegisterType, formatMemoryCell, formatBytes } from '@utils/formatter';
import { setEditorTheme } from '@editor/editor-setup';
import { HOTKEYS, matchesHotkey } from '@utils/hotkeys';

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;

// reactive() auto-unwraps nested refs so we can use store.xxx in templates
const store     = reactive(useAppStore());
const fileStore = reactive(useFileStore());
const editorEl      = ref<HTMLElement | null>(null);
const consoleBodyEl = ref<HTMLElement | null>(null);

const { theme, toggleTheme } = useTheme();

// ── Auto-scroll console on new output ───────────────────
watch(() => store.stdout, () => {
  nextTick(() => {
    if (consoleBodyEl.value) {
      consoleBodyEl.value.scrollTop = consoleBodyEl.value.scrollHeight;
    }
  });
});

// ── Help modal state ─────────────────────────────────────
const helpVisible = ref(false);

// ── Files pane state ──────────────────────────────────────
const FILES_VISIBLE_KEY = 'asciiasm-files-visible';
const filesVisible = ref<boolean>(
  localStorage.getItem(FILES_VISIBLE_KEY) !== 'false',
);
watch(filesVisible, v => localStorage.setItem(FILES_VISIBLE_KEY, String(v)));

// ── Dirty state ───────────────────────────────────────────
const isDirty = computed(() => {
  const cf = fileStore.currentFile;
  if (!cf) return false;
  if (cf.code !== store.source) return true;
  // Check if breakpoints changed
  const savedBps = cf.breakpoints ?? [];
  const currentBps = [...store.breakpoints];
  if (savedBps.length !== currentBps.length) return true;
  const savedSet = new Set(savedBps);
  return currentBps.some(bp => !savedSet.has(bp));
});

// ── File helpers ──────────────────────────────────────────
function formatFileDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Returns false if user cancelled. */
function checkDirty(): boolean {
  if (!isDirty.value) return true;
  return window.confirm(
    `"${fileStore.currentFile!.name}" has unsaved changes.\nDiscard changes and continue?`,
  );
}

function handleOpenFile(id: string) {
  if (id === fileStore.currentFileId) return;
  if (!checkDirty()) return;
  const file = fileStore.files.find(f => f.id === id);
  if (!file) return;
  fileStore.setCurrentFileId(id);
  store.setSource(file.code);
  store.reset();
  store.loadBreakpoints(file.breakpoints ?? []);
}

function handleNewFile() {
  const name = window.prompt('New file name:');
  if (!name?.trim()) return;
  if (fileStore.hasName(name)) {
    window.alert(`A file named "${name.trim()}" already exists. Choose a different name.`);
    return;
  }
  if (!checkDirty()) return;
  const file = fileStore.createFile(name.trim());
  fileStore.setCurrentFileId(file.id);
  store.setSource('');
  store.reset();
  store.loadBreakpoints([]);
  filesVisible.value = true;
}

function handleSaveFile() {
  const bps = [...store.breakpoints];
  if (fileStore.currentFileId) {
    fileStore.saveFile(fileStore.currentFileId, store.source, bps);
  } else {
    const name = window.prompt('Save as (file name):');
    if (!name?.trim()) return;
    if (fileStore.hasName(name)) {
      window.alert(`A file named "${name.trim()}" already exists. Choose a different name.`);
      return;
    }
    const file = fileStore.createFile(name.trim(), store.source);
    fileStore.saveFile(file.id, file.code, bps);
    fileStore.setCurrentFileId(file.id);
  }
}

function handleRenameFile(id: string) {
  const file = fileStore.files.find(f => f.id === id);
  if (!file) return;
  const name = window.prompt('Rename file:', file.name);
  if (!name?.trim() || name.trim() === file.name) return;
  if (fileStore.hasName(name, id)) {
    window.alert(`A file named "${name.trim()}" already exists. Choose a different name.`);
    return;
  }
  fileStore.renameFile(id, name.trim());
}

function handleDuplicateFile(id: string) {
  const src = fileStore.files.find(f => f.id === id);
  if (!src) return;
  const name = window.prompt('Copy name:', `${src.name} copy`);
  if (!name?.trim()) return;
  if (fileStore.hasName(name)) {
    window.alert(`A file named "${name.trim()}" already exists. Choose a different name.`);
    return;
  }
  const copy = fileStore.duplicateFile(id, name.trim());
  fileStore.setCurrentFileId(copy.id);
  store.setSource(copy.code);
  store.reset();
  filesVisible.value = true;
}

function handleDeleteFile(id: string) {
  const file = fileStore.files.find(f => f.id === id);
  if (!file) return;
  if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
  fileStore.deleteFile(id);
  if (fileStore.currentFileId === null) store.reset();
}

function handleMoveFile(id: string, direction: 'up' | 'down') {
  fileStore.moveFile(id, direction);
}

// ── Global keyboard shortcuts ─────────────────────────────
// All key bindings are defined in src/utils/hotkeys.ts
function handleGlobalKey(e: KeyboardEvent) {
  // Ignore if the user is typing in an input/textarea (except the editor)
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  // Ctrl+S — save file
  if (e.ctrlKey && !e.shiftKey && e.key === 's') {
    e.preventDefault();
    handleSaveFile();
    return;
  }

  // F3 — toggle files pane
  if (matchesHotkey(e, HOTKEYS.toggleFiles)) {
    e.preventDefault();
    filesVisible.value = !filesVisible.value;
    return;
  }

  // F4 — new file
  if (matchesHotkey(e, HOTKEYS.newFile)) {
    e.preventDefault();
    handleNewFile();
    return;
  }

  // F1 — show help
  if (matchesHotkey(e, HOTKEYS.help)) {
    e.preventDefault();
    helpVisible.value = !helpVisible.value;
    return;
  }

  if (matchesHotkey(e, HOTKEYS.reset)) {
    e.preventDefault();
    store.reset();
  } else if (matchesHotkey(e, HOTKEYS.stop)) {
    e.preventDefault();
    if (store.canStop) store.stop();
  } else if (matchesHotkey(e, HOTKEYS.run)) {
    e.preventDefault();
    if (store.canRun) store.run();
  } else if (matchesHotkey(e, HOTKEYS.pause)) {
    e.preventDefault();
    if (store.canPause) store.pause();
  } else if (matchesHotkey(e, HOTKEYS.step)) {
    e.preventDefault();
    if (store.canStep) store.stepOver();
  } else if (matchesHotkey(e, HOTKEYS.debug)) {
    // plain F5 — context-sensitive: continue if paused, else start debug
    e.preventDefault();
    if (store.canContinue) store.continueExecution();
    else if (store.canDebug) store.debug();
  }
}

onMounted(() => {
  // Restore the last open file into the editor source before initializing the editor,
  // so that the editor is created with the correct content instead of the default.
  if (fileStore.currentFile) {
    store.setSource(fileStore.currentFile.code);
  }
  if (editorEl.value) {
    store.initEditor(editorEl.value, theme.value);
  }
  document.addEventListener('keydown', handleGlobalKey);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKey);
});

// Keep editor theme in sync whenever the user toggles
watch(theme, (t) => {
  if (store.editorView) {
    setEditorTheme(store.editorView, t);
  }
});

// ── Console pane drag-resize ───────────────────────────────
const CONSOLE_MIN = 80;
const CONSOLE_MAX = 600;
const STORAGE_KEY_H = 'asciiasm-console-height';

const consoleHeight = ref<number>(
  Number(localStorage.getItem(STORAGE_KEY_H)) || 180
);

let dragging = false;
let dragStartY = 0;
let dragStartH = 0;

function startResize(e: PointerEvent) {
  dragging = true;
  dragStartY = e.clientY;
  dragStartH = consoleHeight.value;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onResize(e: PointerEvent) {
  if (!dragging) return;
  // Moving pointer UP increases console height (handle is above the console)
  const delta = dragStartY - e.clientY;
  consoleHeight.value = Math.min(CONSOLE_MAX, Math.max(CONSOLE_MIN, dragStartH + delta));
}

function stopResize() {
  if (!dragging) return;
  dragging = false;
  localStorage.setItem(STORAGE_KEY_H, String(consoleHeight.value));
}

// ── Access Highlight Colors ─────────────────────────────────
// #RRGGBBAA — alpha baked in: 0x8C ≈ 0.55 (memory), 0x4D ≈ 0.30 (registers)
const MEM_READ_COLOR  = '#22c55e8c' // green  55% — memory read
const MEM_WRITE_COLOR = '#ef44448c' // red    55% — memory write
const MEM_BOTH_COLOR  = '#f59e0b8c' // orange 55% — memory read + write
const REG_READ_COLOR  = '#22c55e4d' // green  30% — register read
const REG_WRITE_COLOR = '#ef44444d' // red    30% — register write
const REG_BOTH_COLOR  = '#f59e0b4d' // orange 30% — register read + write

// ── Access highlight sets (O(1) per-cell / per-register lookup) ──
const accessReadSet  = computed(() => new Set(store.accessHighlights.memReads));
const accessWriteSet = computed(() => new Set(store.accessHighlights.memWrites));
const regReadSet     = computed(() => new Set(store.accessHighlights.regReads));
const regWriteSet    = computed(() => new Set(store.accessHighlights.regWrites));

// ── Memory hex-grid ───────────────────────────────────────
const CELLS_PER_ROW = 10;

const memoryRows = computed(() => {
  const rows: { offset: number; cells: number[] }[] = [];
  for (let i = 0; i < store.memory.length; i += CELLS_PER_ROW) {
    rows.push({
      offset: i,
      cells: store.memory.slice(i, i + CELLS_PER_ROW),
    });
  }
  return rows;
});

/** Return inline style for a memory cell: access highlight (priority) or #data tint. */
function memCellStyle(cellIndex: number): Record<string, string> {
  const isRead  = accessReadSet.value.has(cellIndex);
  const isWrite = accessWriteSet.value.has(cellIndex);
  if (isRead && isWrite) return { backgroundColor: MEM_BOTH_COLOR };
  if (isWrite)           return { backgroundColor: MEM_WRITE_COLOR };
  if (isRead)            return { backgroundColor: MEM_READ_COLOR };
  // Fall back to #data directive tint (append 0x47 ≈ 28% alpha)
  const hex = store.memoryColors[cellIndex];
  if (!hex) return {};
  if (hex.length === 7) {
    // If the color is in #RRGGBB format, append alpha
    return { backgroundColor: `${hex}47` };
  } else if (hex.length === 9) {
    // If the color is already in #RRGGBBAA format, use as is
    return { backgroundColor: hex };
  }
  return {};
}

/** Return inline style for a register row based on access highlights. */
function regRowStyle(name: string): Record<string, string> {
  const isRead  = regReadSet.value.has(name);
  const isWrite = regWriteSet.value.has(name);
  if (isRead && isWrite) return { backgroundColor: REG_BOTH_COLOR };
  if (isWrite)           return { backgroundColor: REG_WRITE_COLOR };
  if (isRead)            return { backgroundColor: REG_READ_COLOR };
  return {};
}

// ── Side Panel Tabs ──────────────────────────────────────
const activeTab = ref<'state' | 'stats'>('state');

// ── Stats computed helpers ────────────────────────────────
const sortedInstructionCounts = computed(() => {
  const entries = Object.entries(store.stats.instructionCounts);
  return entries.sort((a, b) => b[1] - a[1]);
});

function handleSpeedChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  store.setSpeed(value === 'Infinity' ? Infinity : Number(value));
}
</script>

<template>
  <!-- ── Toolbar ──────────────────────────────────────── -->
  <div class="toolbar">
    <span class="logo">AsciiAsm IDE <span class="logo-version">v{{ appVersion }}</span></span>

    <!-- Files pane toggle -->
    <button
      class="btn-files"
      @click="filesVisible = !filesVisible"
      :class="{ active: filesVisible }"
      :title="`${filesVisible ? 'Hide' : 'Show'} Files pane — ${HOTKEYS.toggleFiles.label}`"
    >
      <span class="material-symbols-outlined">folder_open</span>
      Files <kbd>{{ HOTKEYS.toggleFiles.label }}</kbd>
    </button>

    <button class="btn-newfile" @click="handleNewFile()" :title="`New virtual file — ${HOTKEYS.newFile.label}`">
      <span class="material-symbols-outlined">note_add</span>
      <kbd>{{ HOTKEYS.newFile.label }}</kbd>
    </button>

    <button
      class="btn-savefile"
      @click="handleSaveFile()"
      :class="{ dirty: isDirty }"
      title="Save current code (Ctrl+S)"
    >
      <span class="material-symbols-outlined">save</span>
    </button>

    <!-- Current file breadcrumb -->
    <span class="current-file" v-if="fileStore.currentFileId !== null">
      <span class="material-symbols-outlined" style="font-size:14px;">description</span>
      {{ fileStore.currentFile?.name }}
      <span v-if="isDirty" class="dirty-dot" title="Unsaved changes">●</span>
    </span>
    <span class="current-file no-file" v-else>unsaved</span>

    <div class="separator"></div>

    <button class="btn-run" @click="store.run()" :disabled="!store.canRun" :title="`Run \u2014 ${HOTKEYS.run.label}`">
      <span class="material-symbols-outlined">play_arrow</span>
      Run <kbd>{{ HOTKEYS.run.label }}</kbd>
    </button>

    <button class="btn-debug" @click="store.debug()" :disabled="!store.canDebug" :title="`Debug \u2014 ${HOTKEYS.debug.label}`">
      <span class="material-symbols-outlined">bug_report</span>
      Debug <kbd>{{ HOTKEYS.debug.label }}</kbd>
    </button>

    <div class="separator"></div>

    <button class="btn-step" @click="store.stepOver()" :disabled="!store.canStep" :title="`Step Over \u2014 ${HOTKEYS.step.label}`">
      <span class="material-symbols-outlined">skip_next</span>
      Step <kbd>{{ HOTKEYS.step.label }}</kbd>
    </button>

    <button class="btn-continue" @click="store.continueExecution()" :disabled="!store.canContinue" :title="`Continue \u2014 ${HOTKEYS.continue.label}`">
      <span class="material-symbols-outlined">fast_forward</span>
      Continue <kbd>{{ HOTKEYS.continue.label }}</kbd>
    </button>

    <div class="separator"></div>

    <button class="btn-stop" @click="store.stop()" :disabled="!store.canStop" :title="`Stop \u2014 ${HOTKEYS.stop.label}`">
      <span class="material-symbols-outlined">stop</span>
      Stop <kbd>{{ HOTKEYS.stop.label }}</kbd>
    </button>

    <button class="btn-pause" @click="store.pause()" :disabled="!store.canPause" :title="`Pause \u2014 ${HOTKEYS.pause.label}`">
      <span class="material-symbols-outlined">pause</span>
      Pause <kbd>{{ HOTKEYS.pause.label }}</kbd>
    </button>

    <button class="btn-reset" @click="store.reset()" :title="`Reset VM \u2014 ${HOTKEYS.reset.label}`">
      <span class="material-symbols-outlined">restart_alt</span>
      Reset <kbd>{{ HOTKEYS.reset.label }}</kbd>
    </button>

    <span class="vm-status" :class="store.vmState.toLowerCase()">
      {{ store.vmState }}
    </span>

    <!-- Speed selector -->
    <select
      class="speed-selector"
      :value="store.speed === Infinity ? 'Infinity' : store.speed"
      @change="handleSpeedChange"
      title="VM execution speed (instructions per second)"
    >
      <option v-for="p in store.SPEED_PRESETS" :key="p.label" :value="p.value === Infinity ? 'Infinity' : p.value">
        {{ p.label }}
      </option>
    </select>

    <button class="btn-theme" @click="toggleTheme()" :title="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
      <span class="material-symbols-outlined">{{ theme === 'dark' ? 'light_mode' : 'dark_mode' }}</span>
    </button>

    <button class="btn-help" @click="helpVisible = true" :title="`Language Specification — ${HOTKEYS.help.label}`">
      <span class="material-symbols-outlined">help</span>
      <kbd>{{ HOTKEYS.help.label }}</kbd>
    </button>
  </div>

  <!-- ── Help Modal ───────────────────────────────────── -->
  <HelpModal v-if="helpVisible" @close="helpVisible = false" />

  <!-- ── Main Layout ──────────────────────────────────── -->
  <div class="main-layout">

    <!-- ── Files pane ────────────────────────────────── -->
    <div class="files-pane" v-show="filesVisible">
      <div class="files-header">
        <span class="material-symbols-outlined" style="font-size:15px;">folder_open</span>
        Files
        <span class="files-count" v-if="fileStore.files.length > 0">{{ fileStore.files.length }}</span>
      </div>

      <div class="files-list">
        <div
          v-for="file in fileStore.files"
          :key="file.id"
          class="file-item"
          :class="{ active: file.id === fileStore.currentFileId }"
          @click="handleOpenFile(file.id)"
          :title="`Version: ${file.ideversion}\nSaved: ${formatFileDate(file.date)}`"
        >
          <div class="file-item-info">
            <span class="file-item-name">{{ file.name }}</span>
            <span class="file-item-date">{{ formatFileDate(file.date) }}</span>
          </div>
          <div class="file-item-actions">
            <button
              class="file-action-btn"
              @click.stop="handleMoveFile(file.id, 'up')"
              :disabled="fileStore.files.indexOf(file) === 0"
              title="Move up"
            ><span class="material-symbols-outlined">arrow_upward</span></button>
            <button
              class="file-action-btn"
              @click.stop="handleMoveFile(file.id, 'down')"
              :disabled="fileStore.files.indexOf(file) === fileStore.files.length - 1"
              title="Move down"
            ><span class="material-symbols-outlined">arrow_downward</span></button>
            <button
              class="file-action-btn"
              @click.stop="handleDuplicateFile(file.id)"
              title="Duplicate"
            ><span class="material-symbols-outlined">content_copy</span></button>
            <button
              class="file-action-btn"
              @click.stop="handleRenameFile(file.id)"
              title="Rename"
            ><span class="material-symbols-outlined">drive_file_rename_outline</span></button>
            <button
              class="file-action-btn file-action-delete"
              @click.stop="handleDeleteFile(file.id)"
              title="Delete"
            ><span class="material-symbols-outlined">delete</span></button>
          </div>
        </div>

        <div v-if="fileStore.files.length === 0" class="files-empty">
          No saved files yet.<br>
          Click <strong>+</strong> to create one.
        </div>
      </div>
    </div>

    <!-- ── Left column: editor + resizable console ──── -->
    <div class="left-column">

      <!-- Editor -->
      <div class="editor-panel">
        <div class="editor-container" ref="editorEl"></div>
      </div>

      <!-- Drag handle -->
      <div
        class="resize-handle"
        @pointerdown.prevent="startResize"
        @pointermove="onResize"
        @pointerup="stopResize"
        @pointercancel="stopResize"
        title="Drag to resize console"
      ></div>

      <!-- Console pane (always visible, split: Console | Errors) -->
      <div class="console-pane" :style="{ height: consoleHeight + 'px' }">

        <!-- Left: stdout output -->
        <div class="console-section">
          <div class="console-header">
            <span class="material-symbols-outlined" style="font-size:15px;">terminal</span>
            Console
            <button
              class="console-clear-btn"
              @click="store.clearConsole()"
              title="Clear console"
              :disabled="!store.stdout"
            >
              <span class="material-symbols-outlined">delete_sweep</span>
            </button>
          </div>
          <div class="console-body" ref="consoleBodyEl">
            <div class="console-output">{{ store.stdout }}</div>
          </div>
        </div>

        <!-- Divider -->
        <div class="console-vertical-divider"></div>

        <!-- Right: parse / runtime errors -->
        <div class="errors-section">
          <div class="console-header">
            <span class="material-symbols-outlined" style="font-size:15px;">error</span>
            Errors
            <span
              v-if="store.parseErrors.length > 0 || store.runtimeError"
              class="errors-badge"
            >{{ store.parseErrors.length + (store.runtimeError ? 1 : 0) }}</span>
            <span v-else class="errors-ok">✓</span>
          </div>
          <div class="console-body">
            <div v-if="store.runtimeError" class="error-runtime">
              Runtime: {{ store.runtimeError }}
            </div>
            <div class="errors-list" v-if="store.parseErrors.length > 0">
              <div class="error-item" v-for="(err, i) in store.parseErrors" :key="i">
                <div class="error-location">Line {{ err.line }}, Col {{ err.col }}</div>
                <div class="error-message">{{ err.message }}</div>
              </div>
            </div>
            <div v-if="store.parseErrors.length === 0 && !store.runtimeError" class="no-errors">
              No errors
            </div>
          </div>
        </div>

      </div>

    </div>

    <!-- ── Side Panel ────────────────────────────────── -->
    <div class="side-panel">

      <!-- Panel header with tabs -->
      <div class="tab-bar">
        <button
          :class="{ active: activeTab === 'state' }"
          @click="activeTab = 'state'"
        >Registers &amp; Memory</button>
        <button
          :class="{ active: activeTab === 'stats' }"
          @click="activeTab = 'stats'"
        >Statistics</button>
      </div>

      <!-- Panel content: Registers & Memory -->
      <div class="panel-content" v-show="activeTab === 'state'">

        <!-- Registers -->
        <div>
          <div class="registers-list">
            <div
              class="register-row"
              v-for="name in ['AX', 'BX', 'CX', 'DX']"
              :key="name"
              :style="regRowStyle(name)"
            >
              <span class="register-name">{{ name }}</span>
              <span class="register-type">{{ formatRegisterType(store.registers[name]) }}</span>
              <span class="register-value">{{ formatRegisterValue(store.registers[name]) }}</span>
            </div>
          </div>
          <div class="flags-bar">
            <div class="flag-item">
              <span class="flag-name">ZF</span>
              <span class="flag-value" :class="store.flags.ZF ? 'set' : 'clear'">{{ store.flags.ZF ? '1' : '0' }}</span>
            </div>
            <div class="flag-item">
              <span class="flag-name">SF</span>
              <span class="flag-value" :class="store.flags.SF ? 'set' : 'clear'">{{ store.flags.SF ? '1' : '0' }}</span>
            </div>
            <div class="flag-item">
              <span class="flag-name">OF</span>
              <span class="flag-value" :class="store.flags.OF ? 'set' : 'clear'">{{ store.flags.OF ? '1' : '0' }}</span>
            </div>
          </div>

          <!-- Memory -->
          <div class="section-label">Memory</div>
          <div v-if="store.memory.length === 0" class="no-errors">
            Run or debug a program to see memory contents.
          </div>
          <table v-else class="memory-grid">
            <thead>
              <tr>
                <th class="mem-offset">+</th>
                <th v-for="col in CELLS_PER_ROW" :key="col" class="mem-col-head">{{ col - 1 }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in memoryRows" :key="row.offset">
                <td class="mem-offset">{{ row.offset }}</td>
                <td
                  v-for="(code, col) in row.cells"
                  :key="col"
                  class="mem-cell"
                  :style="memCellStyle(row.offset + col)"
                  :title="`[${row.offset + col}] = ${code}`"
                >{{ formatMemoryCell(code) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      <!-- Panel content: Statistics -->
      <div class="panel-content" v-show="activeTab === 'stats'">
        <div class="stats-panel">

          <!-- Total instructions -->
          <div class="stats-section">
            <div class="section-label">Execution</div>
            <div class="stats-row">
              <span class="stats-label">Total instructions</span>
              <span class="stats-value">{{ store.stats.totalInstructions.toLocaleString() }}</span>
            </div>
          </div>

          <!-- Per-instruction breakdown -->
          <div class="stats-section" v-if="sortedInstructionCounts.length > 0">
            <div class="section-label">Instruction Counts</div>
            <div class="stats-row" v-for="[mnemonic, count] in sortedInstructionCounts" :key="mnemonic">
              <span class="stats-label">{{ mnemonic }}</span>
              <span class="stats-value">{{ count.toLocaleString() }}</span>
            </div>
          </div>

          <!-- Memory access -->
          <div class="stats-section">
            <div class="section-label">Memory Access</div>
            <div class="stats-row">
              <span class="stats-label">Read operations</span>
              <span class="stats-value">{{ store.stats.memoryReads.toLocaleString() }}</span>
            </div>
            <div class="stats-row">
              <span class="stats-label">Data read</span>
              <span class="stats-value">{{ formatBytes(store.stats.memoryReadBytes) }}</span>
            </div>
            <div class="stats-row">
              <span class="stats-label">Write operations</span>
              <span class="stats-value">{{ store.stats.memoryWrites.toLocaleString() }}</span>
            </div>
            <div class="stats-row">
              <span class="stats-label">Data written</span>
              <span class="stats-value">{{ formatBytes(store.stats.memoryWriteBytes) }}</span>
            </div>
          </div>

          <!-- Register access -->
          <div class="stats-section">
            <div class="section-label">Register Access</div>
            <div class="stats-row">
              <span class="stats-label">Read operations</span>
              <span class="stats-value">{{ store.stats.registerReads.toLocaleString() }}</span>
            </div>
            <div class="stats-row">
              <span class="stats-label">Write operations</span>
              <span class="stats-value">{{ store.stats.registerWrites.toLocaleString() }}</span>
            </div>
          </div>

          <div v-if="store.stats.totalInstructions === 0" class="no-errors">
            Run or debug a program to see execution statistics.
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
