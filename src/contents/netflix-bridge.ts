import type { PlasmoCSConfig } from 'plasmo';
import { initNetflixPageBridge } from '~lib/services/netflix-bridge';

export const config: PlasmoCSConfig = {
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  run_at: 'document_start',
};

initNetflixPageBridge();
