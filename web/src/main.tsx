// Entry point. Order matters: the theme variables and the persisted settings are
// applied before the first render so the very first frame already has the right
// UI scale, palette and motion preference.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted variable fonts (FONTS in theme/tokens.ts): Inter for the UI,
// Fraunces (optical-size axis, roman + italic) for display and newspaper type.
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import { installThemeVars } from './theme/cssVars';
import { installSettingsEffects } from './state/settingsEffects';
import { installAudioUnlock } from './ui/sound';
import { installQaHandle } from './ui/qa';
import { App } from './App';
import './styles/global.css';

installThemeVars();
installSettingsEffects();
installAudioUnlock();
installQaHandle();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
