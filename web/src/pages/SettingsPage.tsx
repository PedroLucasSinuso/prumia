import { ChevronLeft, ChevronRight, CircleUserRound, Database, Info, Palette, Store, Tags, Users, Wallet, type LucideIcon } from 'lucide-react'
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'

import { useCategories } from '../api/queries'
import type { Me } from '../api/types'
import { useAuth } from '../auth/context'
import { useActiveHouse, type House } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { AboutSection } from '../components/settings/AboutSection'
import { AccountSection } from '../components/settings/AccountSection'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { CategoriesSection } from '../components/settings/CategoriesSection'
import { DataSection } from '../components/settings/DataSection'
import { HouseSection } from '../components/settings/HouseSection'
import { PayeesSection } from '../components/settings/PayeesSection'
import { WalletsSection } from '../components/settings/WalletsSection'
import { ICON } from '../lib/navigation'
import { useIsDesktop } from '../lib/useIsDesktop'

type SectionId = 'casa' | 'categorias' | 'carteiras' | 'favorecidos' | 'aparencia' | 'conta' | 'dados' | 'sobre'

/** As seções de Ajustes, na ordem do menu. O `id` é o último pedaço do endereço (/ajustes/casa). */
const SECTIONS: { id: SectionId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'casa', label: 'Casa e pessoas', hint: 'Quem mora, convites, nome da casa', icon: Users },
  { id: 'categorias', label: 'Categorias', hint: 'Organize e ordene os gastos', icon: Tags },
  { id: 'carteiras', label: 'Carteiras', hint: 'Onde o dinheiro da casa fica', icon: Wallet },
  { id: 'favorecidos', label: 'Favorecidos', hint: 'Quem recebe: empresas e pessoas', icon: Store },
  { id: 'aparencia', label: 'Aparência', hint: 'Tema de cor', icon: Palette },
  { id: 'conta', label: 'Minha conta', hint: 'Nome, senha e aparelhos', icon: CircleUserRound },
  { id: 'dados', label: 'Dados', hint: 'Exportar para planilha', icon: Database },
  { id: 'sobre', label: 'Sobre', hint: 'Versão e guias', icon: Info },
]

/**
 * Ajustes: um painel único para a casa e para a conta.
 * - Computador: sub-navegação à esquerda e a seção escolhida à direita (/ajustes cai em /ajustes/casa).
 * - Celular: /ajustes é um menu de seções; cada seção abre em tela própria, com "voltar".
 * O `key` na casa ativa remonta a tela ao trocar de casa (nada de painel aberto de uma casa vazando para a outra).
 */
export default function SettingsPage() {
  const { house } = useActiveHouse()
  return <SettingsView key={house?.id ?? 'sem-casa'} />
}

function SettingsView() {
  const { secao } = useParams()
  const desktop = useIsDesktop()
  const { session } = useAuth()
  const { house } = useActiveHouse()
  const navigate = useNavigate()

  if (session.status !== 'authenticated') return null
  const current = SECTIONS.find((s) => s.id === secao)
  if (secao && !current) return <Navigate to="/ajustes" replace />
  if (!secao && desktop) return <Navigate to="/ajustes/casa" replace />

  const nav = (
    <nav aria-label="Seções de ajustes" className="flex flex-col gap-0.5">
      {SECTIONS.map((s) => {
        const Icon = s.icon
        return desktop ? (
          <NavLink
            key={s.id}
            to={`/ajustes/${s.id}`}
            className={({ isActive }) =>
              `flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150 ${isActive ? 'bg-structure/10 font-semibold text-heading' : 'text-muted hover:bg-ink/6'}`
            }
          >
            <Icon aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} className="shrink-0" />
            {s.label}
          </NavLink>
        ) : (
          <NavLink key={s.id} to={`/ajustes/${s.id}`} className="flex min-h-14 items-center gap-3 border-t border-line px-1 first:border-t-0">
            <Icon aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} className="shrink-0 text-heading" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-medium">{s.label}</span>
              <span className="truncate text-xs text-muted">{s.hint}</span>
            </span>
            <ChevronRight aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} className="shrink-0 text-muted" />
          </NavLink>
        )
      })}
    </nav>
  )

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-36 pt-4 md:max-w-none md:px-10 md:pb-10 md:pt-8">
        {desktop || !current ? (
          <header>
            <h1 className="font-display text-[32px] font-bold leading-none text-heading font-stretch-condensed">Ajustes</h1>
            <p className="mt-1 text-sm text-muted">Molde o prumia ao jeito da sua casa.</p>
          </header>
        ) : (
          <button type="button" onClick={() => navigate('/ajustes')} className="-ml-1 flex h-11 w-fit items-center gap-1 rounded-md pr-3 text-sm font-semibold text-accent">
            <ChevronLeft aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} />
            Ajustes
          </button>
        )}

        {desktop ? (
          <div className="grid items-start gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
            <div className="md:sticky md:top-6">{nav}</div>
            <div className="min-w-0">{current && <SectionBody id={current.id} me={session.me} house={house} desktop />}</div>
          </div>
        ) : current ? (
          <SectionBody id={current.id} me={session.me} house={house} desktop={false} />
        ) : (
          nav
        )}
      </main>
    </AppShell>
  )
}

function SectionBody({ id, me, house, desktop }: { id: SectionId; me: Me; house?: House; desktop: boolean }) {
  switch (id) {
    case 'aparencia':
      return <AppearanceSection />
    case 'conta':
      return <AccountSection me={me} />
    case 'sobre':
      return <AboutSection />
  }
  // As demais seções dependem de uma casa ativa.
  if (!house) return <p className="text-sm text-muted">Você ainda não está em nenhuma casa.</p>
  const canWrite = house.role !== 'viewer'
  switch (id) {
    case 'casa':
      return <HouseSection me={me} house={house} />
    case 'categorias':
      return <CategoriesSection houseId={house.id} canWrite={canWrite} desktop={desktop} />
    case 'carteiras':
      return <WalletsSection houseId={house.id} isAdmin={house.role === 'admin'} desktop={desktop} />
    case 'favorecidos':
      return <PayeesWithCategories houseId={house.id} canWrite={canWrite} desktop={desktop} />
    case 'dados':
      return <DataSection />
  }
}

/** Favorecidos precisa da lista de categorias (categoria sugerida): busca aqui para a seção ficar independente. */
function PayeesWithCategories({ houseId, canWrite, desktop }: { houseId: string; canWrite: boolean; desktop: boolean }) {
  const categories = useCategories(houseId)
  return <PayeesSection houseId={houseId} categories={categories.data ?? []} canWrite={canWrite} desktop={desktop} />
}
