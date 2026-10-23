// Aplica o tema salvo ANTES do app carregar, para a tela não piscar no tema errado.
// Arquivo externo (e não <script> inline) porque a CSP do nginx só aceita scripts de 'self'.
// Mantenha em sincronia com src/lib/theme.ts (chave, temas e cores da barra do sistema).
;(function () {
  var themes = ['marfim', 'grafite', 'contraste', 'sistema']
  var color = { marfim: '#203D40', grafite: '#313638', contraste: '#203D40' }
  var theme = 'marfim'
  try {
    var saved = window.localStorage.getItem('prumia.theme')
    if (themes.indexOf(saved) !== -1) theme = saved
  } catch {
    // sem armazenamento (aba anônima, bloqueio): fica o padrão
  }
  var resolved = theme
  if (theme === 'sistema') {
    var dark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    resolved = dark ? 'grafite' : 'marfim'
  }
  document.documentElement.setAttribute('data-theme', theme)
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', color[resolved])
})()
