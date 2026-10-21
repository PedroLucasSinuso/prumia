import { createContext, useContext } from 'react'

export type ToastInput = { message: string; actionLabel?: string; onAction?: () => void }

export const ToastContext = createContext<((t: ToastInput) => void) | null>(null)

export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return ctx
}
