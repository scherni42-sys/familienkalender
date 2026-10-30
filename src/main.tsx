import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Root } from './app/Root';

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
