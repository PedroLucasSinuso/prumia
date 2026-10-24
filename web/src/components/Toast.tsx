import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { canAnimate, EXIT_MS } from '../lib/motion'
import { ToastContext, type ToastInput } from './toastContext'

type ToastState = ToastInput & { id: number }

const LIFETIME_MS = 7000

/**
 * Aviso temporário no rodapé, com ação opcional ("Desfazer"). Um por vez; some em 7 s.
 * Entra subindo com fade e sai descendo (150 ms, `motion-safe`). Com ação, uma barra fina no fundo esvazia mostrando
 * quanto tempo resta para desfazer (a barra é decorativa: o aviso continua sendo lido por `role="status"`).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [leaving, setLeaving] = useState(false)
  const nextId = useRef(1)
  const exit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const show = useCallback((t: ToastInput) => {
    clearTimeout(exit.current)
    setLeaving(false)
    setToast({ ...t, id: nextId.current++ })
  }, [])
  const value = useMemo(() => show, [show])

  // Sai com animação (se permitida) e só então some do DOM.
  const dismiss = useCallback(() => {
    if (!canAnimate()) return setToast(null)
    setLeaving(true)
    exit.current = setTimeout(() => {
      setToast(null)
      setLeaving(false)
    }, EXIT_MS)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismiss, LIFETIME_MS)
    return () => clearTimeout(timer)
  }, [toast, dismiss])
  useEffect(() => () => clearTimeout(exit.current), [])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-44 md:pb-8">
        {toast && (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto relative flex w-full max-w-md items-center justify-between gap-3 overflow-hidden rounded-md bg-ink px-4 py-3 text-sm text-surface ${
              leaving ? 'motion-safe:animate-toast-out' : 'motion-safe:animate-toast-in'
            }`}
          >
            <span>{toast.message}</span>
            {toast.actionLabel && (
              <button
                className="h-9 shrink-0 rounded-sm px-2 font-semibold underline underline-offset-2 transition-colors hover:bg-surface/15 active:bg-surface/25"
                onClick={() => {
                  toast.onAction?.()
                  dismiss()
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            {toast.actionLabel && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-surface/60 motion-safe:animate-countdown motion-reduce:hidden" />}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
