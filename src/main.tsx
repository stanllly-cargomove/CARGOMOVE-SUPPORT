import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { loadCustomerConfiguration } from './services/customerConfiguration';
import brandLogo from '../media/image-removebg-preview.webp';
import homeBackground from '../media/home-port-background-fast.webp';
import guidelineBackground from '../media/guideline-background-fast.webp';
import registrationBackground from '../media/registration-background-fast.webp';
import portHeroImage from '../media/registration-port-hero-fast.webp';
import depotHeroImage from '../media/registration-depot-card-fast.webp';

// Begin loading the public facility list and shared visual assets while React starts.
void loadCustomerConfiguration().catch(() => undefined);
for (const source of [brandLogo, homeBackground, guidelineBackground, registrationBackground, portHeroImage, depotHeroImage]) {
  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = 'low';
  image.src = source;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
