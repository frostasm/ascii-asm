import { ref, watch } from 'vue';

export type SpecLanguage = 'en' | 'uk';

const STORAGE_KEY = 'asciiasm-spec-language';

function detectPreferred(): SpecLanguage {
  const stored = localStorage.getItem(STORAGE_KEY) as SpecLanguage | null;
  if (stored === 'en' || stored === 'uk') return stored;
  // Default to English
  return 'en';
}

// Singleton language ref shared across all composable calls
const specLanguage = ref<SpecLanguage>(detectPreferred());

// Persist language preference
watch(
  specLanguage,
  (lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
  },
);

export function useLanguage() {
  function setSpecLanguage(lang: SpecLanguage) {
    specLanguage.value = lang;
  }

  return {
    specLanguage,
    setSpecLanguage,
  };
}
