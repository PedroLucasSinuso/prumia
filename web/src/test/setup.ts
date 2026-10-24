import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Telas lazy + jsdom em máquina ocupada (CI, vários arquivos em paralelo) passam de 1 s: espera até 5 s antes de falhar.
configure({ asyncUtilTimeout: 5000 })

// O localStorage do jsdom vive durante o arquivo todo: limpa entre os testes (preferências e "recentes" não vazam).
afterEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // sem armazenamento: nada a limpar
  }
})
