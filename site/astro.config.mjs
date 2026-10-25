// Site público do prumia: documentação (e, nas próximas fases, landing e demo). Os guias vêm de docs/ (scripts/sync-docs.mjs).
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'

export default defineConfig({
  site: 'https://prumia.pages.dev', // trocar pelo domínio definitivo quando o projeto no Cloudflare Pages existir
  integrations: [
    starlight({
      title: 'prumia',
      description: 'Clareza para construir o futuro. Finanças da casa, sem planilha.',
      logo: { light: './src/assets/simbolo.svg', dark: './src/assets/simbolo-escuro.svg', alt: '' },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: { root: { label: 'Português', lang: 'pt-BR' } },
      customCss: [
        '@fontsource-variable/archivo/wdth.css',
        '@fontsource/ibm-plex-sans/400.css',
        '@fontsource/ibm-plex-sans/600.css',
        '@fontsource/ibm-plex-mono/400.css',
        './src/styles/marca.css',
      ],
      lastUpdated: false,
      pagination: true,
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false, exclude: ['/demo/', '/demo/**'] })], // o guia técnico cita http://localhost:8080 de propósito
      sidebar: [
        {
          label: 'Comece aqui',
          items: ['guias/o-que-e-o-prumia', 'guias/primeiros-passos', { label: 'Instalar no celular', slug: 'guias/instalar-no-celular' }, 'guias/glossario'],
        },
        {
          label: 'No dia a dia',
          items: [
            'guias/cadastrar-e-pagar-contas',
            'guias/parcelas-e-contas-fixas',
            { label: 'Importar boleto e listas', slug: 'guias/importar-boleto' },
            { label: 'Salário e outras receitas', slug: 'guias/salario-e-previsao' },
            'guias/resumo-do-mes',
          ],
        },
        { label: 'Dinheiro da casa', items: [{ label: 'Carteiras, reserva e investimentos', slug: 'guias/carteiras' }] },
        { label: 'Casa e pessoas', items: ['guias/convidar-pessoas', { label: 'Ajustes e categorias', slug: 'guias/categorias-e-ajustes' }] },
        { label: 'Ajuda', items: ['guias/perguntas-frequentes'] },
        {
          label: 'Para quem hospeda',
          items: [{ label: 'Acessar pelo celular (Tailscale)', slug: 'guias/acessar-pelo-celular' }, { label: 'Backup e restauração', slug: 'guias/fazer-backup' }],
        },
        { label: 'Desenvolvimento', collapsed: true, items: [{ autogenerate: { directory: 'dev' } }] },
      ],
    }),
  ],
})
