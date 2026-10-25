// Gera as páginas do site a partir dos Markdown de docs/ (a fonte de verdade continua lá; nada é copiado à mão).
// - docs/user-guides/*.md    -> src/content/docs/guias/*.md
// - docs/developer-guide/*.md -> src/content/docs/dev/*.md   (README.md vira o index da seção)
// O título vem do primeiro "# ..." (vira frontmatter) e a descrição, da primeira frase depois dele.
// Links entre guias (x.md, ../developer-guide/y.md#z) viram rotas do site; links para fora das duas pastas viram texto,
// porque o repositório é privado e o site é público.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = resolve(root, 'site', 'src', 'content', 'docs')

const sections = [
  { from: 'docs/user-guides', to: 'guias' },
  { from: 'docs/developer-guide', to: 'dev' },
]
const routeOf = { 'user-guides': 'guias', 'developer-guide': 'dev' }

function slugOf(file) {
  return file === 'README.md' ? '' : file.replace(/\.md$/, '')
}

// Reescreve um destino de link Markdown. `section` é a pasta de origem ('user-guides' ou 'developer-guide').
function rewriteTarget(target, section) {
  if (/^(https?:|mailto:|#)/.test(target)) return target
  const [path, hash] = target.split('#')
  const m = path.match(/^(?:\.\.\/(user-guides|developer-guide)\/)?([a-z0-9-]+|README)\.md$/i)
  if (!m) return null // fora das duas seções: vira texto
  const dir = routeOf[m[1] ?? section]
  const slug = m[2] === 'README' ? '' : `${m[2]}/`
  return `/${dir}/${slug}${hash ? `#${hash}` : ''}`
}

function convert(text, section) {
  const lines = text.split('\n')
  const h1 = lines.findIndex((l) => l.startsWith('# '))
  if (h1 < 0) throw new Error('guia sem título "# ..."')
  const title = lines[h1].slice(2).trim()
  const rest = lines.slice(h1 + 1)
  const firstPara = rest.find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('-'))
  const description = firstPara ? firstPara.split(/(?<=\.)\s/)[0].replace(/[*`[\]]/g, '').replace(/\(([^)]*)\)/g, '').trim() : ''
  let body = rest.join('\n')
  // [texto](destino) -> rota do site, ou só o texto quando o destino não é publicado
  body = body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, target) => {
    const t = rewriteTarget(target, section)
    return t === null ? label : `[${label}](${t})`
  })
  const fm = ['---', `title: ${JSON.stringify(title)}`]
  if (description) fm.push(`description: ${JSON.stringify(description)}`)
  fm.push('---', '')
  return fm.join('\n') + body.replace(/^\n+/, '')
}

let count = 0
for (const { from, to } of sections) {
  const src = resolve(root, from)
  const dst = join(out, to)
  if (existsSync(dst)) rmSync(dst, { recursive: true })
  mkdirSync(dst, { recursive: true })
  const section = from.split('/').pop()
  for (const file of readdirSync(src).filter((f) => f.endsWith('.md'))) {
    const slug = slugOf(file)
    const target = join(dst, slug ? `${slug}.md` : 'index.md')
    writeFileSync(target, convert(readFileSync(join(src, file), 'utf8'), section))
    count++
  }
}
console.log(`sync-docs: ${count} páginas geradas em src/content/docs/{guias,dev}`)
