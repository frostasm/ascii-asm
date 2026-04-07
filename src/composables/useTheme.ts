import { ref, watch } from 'vue';

export type AppTheme = 'dark' | 'light';

const STORAGE_KEY = 'asciiasm-theme';

function detectPreferred(): AppTheme {
  const stored = localStorage.getItem(STORAGE_KEY) as AppTheme | null;
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Singleton theme ref shared across all composable calls
const theme = ref<AppTheme>(detectPreferred());

// Apply the theme attribute to <html> immediately
watch(
  theme,
  (t) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(STORAGE_KEY, t);
  },
  { immediate: true },
);

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  return { theme, toggleTheme };
}
