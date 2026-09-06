import type { PlasmoCSConfig } from 'plasmo';
import { initYouTubePageBridge } from '~lib/services/youtube-bridge';

export const config: PlasmoCSConfig = {
  matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*'],
  world: 'MAIN',
  run_at: 'document_start',
};

initYouTubePageBridge();
