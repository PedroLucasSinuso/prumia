import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/Toast'
import { registerServiceWorker } from './lib/pwa'
import { startThemeSync } from './lib/theme'
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import './index.css'

// Dados do servidor ficam em cache e são refeitos sozinhos depois de cada ação. Sem retentativa automática
// em erros de negócio (4xx); a tela oferece "Tentar de novo".
// networkMode 'always': o padrão do TanStack Query pausa tudo quando o navegador diz que está offline, e a tela
// ficaria carregando para sempre. Aqui a chamada sempre sai: o service worker responde com os dados guardados (leitura)
// ou a escrita falha logo, com a mensagem de sem conexão.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
})
// Voltou a conexão: refaz o que está na tela (troca os dados guardados pelos de agora).
window.addEventListener('online', () => void queryClient.invalidateQueries())

// Tema de cor (Marfim, Grafite, Contraste, Sistema): ver src/lib/theme.ts.
startThemeSync()

function start() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </StrictMode>,
  )
}

// Demonstração (build com VITE_DEMO=1): troca a API por uma falsa em memória antes de o app rodar. No build normal a
// condição é falsa em tempo de compilação e o código da demonstração nem entra no pacote.
if (import.meta.env.VITE_DEMO === '1') void import('./demo/install').then(start)
else start()

// PWA: instalável e com leitura offline (public/sw.js). Não registra em dev nem fora de HTTPS/localhost.
if (import.meta.env.VITE_DEMO !== '1') registerServiceWorker()
