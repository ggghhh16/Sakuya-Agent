import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';
import './minimal.css';
import './workspace.css';
import { AuthGate } from './auth';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><AuthGate>{user => <App key={user.id} user={user} />}</AuthGate></QueryClientProvider></React.StrictMode>);
