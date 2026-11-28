import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { EmailLinkPage } from './EmailLinkPage';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Не найден корневой элемент приложения.');
createRoot(root).render(
  <StrictMode>
    {location.pathname === `${import.meta.env.BASE_URL}email-link` ? <EmailLinkPage /> : <App />}
  </StrictMode>,
);
