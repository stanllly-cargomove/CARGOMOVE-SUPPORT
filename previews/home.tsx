import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { HomePage } from '../src/components/customer/HomePage';

createRoot(document.getElementById('root')!).render(<React.StrictMode><HomePage /></React.StrictMode>);
