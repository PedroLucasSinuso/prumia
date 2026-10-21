import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ToastContext, type ToastInput } from './toastContext'

type ToastState = ToastInput & { id: number }

/** Aviso temporário no rodapé, com ação opcional ("Desfazer"). Um por vez; some em 7 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const nextId = useRef(1)

  const show = useCallback((t: ToastInput) => setToast({ ...t, id: nextId.current++ }), [])
  const value = useMemo(() => show, [show])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-44 md:pb-8">
        {toast && (
          <div
            role="status"
            className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-md bg-graphite px-4 py-3 text-sm text-ivory"
          >
            <span>{toast.message}</span>
            {toast.actionLabel && (
              <button
                className="h-9 shrink-0 rounded-sm px-2 font-semibold underline underline-offset-2"
                onClick={() => {
                  toast.onAction?.()
                  setToast(null)
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
