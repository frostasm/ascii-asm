import { ref, computed } from 'vue';

declare const __APP_VERSION__: string;

// ── Types ──────────────────────────────────────────────────

export interface VirtualFile {
  id: string;
  name: string;
  date: string;       // ISO-8601
  ideversion: string;
  code: string;
}

// ── Persistence helpers ────────────────────────────────────

const STORAGE_KEY         = 'asciiasm-files';
const CURRENT_FILE_KEY    = 'asciiasm-current-file-id';

function load(): VirtualFile[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function persist(list: VirtualFile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ── Singletons (shared across all composable calls) ────────

const files         = ref<VirtualFile[]>(load());
const currentFileId = ref<string | null>(localStorage.getItem(CURRENT_FILE_KEY));

// guard: stored id might no longer exist
if (currentFileId.value && !files.value.find(f => f.id === currentFileId.value)) {
  currentFileId.value = null;
  localStorage.removeItem(CURRENT_FILE_KEY);
}

// ── Composable ─────────────────────────────────────────────

export function useFileStore() {
  const currentFile = computed(() =>
    files.value.find(f => f.id === currentFileId.value) ?? null,
  );

  function createFile(name: string, code = ''): VirtualFile {
    const file: VirtualFile = {
      id: crypto.randomUUID(),
      name: name.trim(),
      date: new Date().toISOString(),
      ideversion: __APP_VERSION__,
      code,
    };
    files.value = [file, ...files.value];
    persist(files.value);
    return file;
  }

  /** Returns true if a file with this name already exists (optionally ignoring one id). */
  function hasName(name: string, excludeId?: string): boolean {
    const n = name.trim().toLowerCase();
    return files.value.some(f => f.name.toLowerCase() === n && f.id !== excludeId);
  }

  function duplicateFile(id: string, newName: string): VirtualFile {
    const src = files.value.find(f => f.id === id);
    if (!src) throw new Error(`File ${id} not found`);
    return createFile(newName.trim(), src.code);
  }

  function saveFile(id: string, code: string) {
    files.value = files.value.map(f =>
      f.id === id
        ? { ...f, code, date: new Date().toISOString(), ideversion: __APP_VERSION__ }
        : f,
    );
    persist(files.value);
  }

  function renameFile(id: string, name: string) {
    files.value = files.value.map(f =>
      f.id === id ? { ...f, name: name.trim() } : f,
    );
    persist(files.value);
  }

  function deleteFile(id: string) {
    files.value = files.value.filter(f => f.id !== id);
    if (currentFileId.value === id) setCurrentFileId(null);
    persist(files.value);
  }

  function moveFile(id: string, direction: 'up' | 'down') {
    const idx = files.value.findIndex(f => f.id === id);
    if (idx === -1) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= files.value.length) return;
    const next = [...files.value];
    [next[idx], next[target]] = [next[target], next[idx]];
    files.value = next;
    persist(files.value);
  }

  function setCurrentFileId(id: string | null) {
    currentFileId.value = id;
    if (id) localStorage.setItem(CURRENT_FILE_KEY, id);
    else localStorage.removeItem(CURRENT_FILE_KEY);
  }

  return {
    files,
    currentFileId,
    currentFile,
    hasName,
    createFile,
    duplicateFile,
    saveFile,
    renameFile,
    moveFile,
    deleteFile,
    setCurrentFileId,
  };
}
