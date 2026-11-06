'use client'

// Inspired by react-hot-toast library
import * as React from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import type { ToastActionElement, ToastProps } from '@/components/ui/toast'
import { TOAST } from '@/constants'
import { shouldRouteToastToNotice } from '@/utils/shellNotice'

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

// eslint-disable-next-line unused-imports/no-unused-vars
const actionTypes = {
  ADD_TOAST: 'ADD_TOAST',
  UPDATE_TOAST: 'UPDATE_TOAST',
  DISMISS_TOAST: 'DISMISS_TOAST',
  REMOVE_TOAST: 'REMOVE_TOAST',
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType['ADD_TOAST']
      toast: ToasterToast
    }
  | {
      type: ActionType['UPDATE_TOAST']
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType['DISMISS_TOAST']
      toastId?: ToasterToast['id']
    }
  | {
      type: ActionType['REMOVE_TOAST']
      toastId?: ToasterToast['id']
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

function addToRemoveQueue(toastId: string) {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: 'REMOVE_TOAST',
      toastId,
    })
  }, TOAST.REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TOAST':
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST.LIMIT),
      }

    case 'UPDATE_TOAST':
      return {
        ...state,
        toasts: state.toasts.map(t => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      }

    case 'DISMISS_TOAST': {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        for (const toast of state.toasts) {
          addToRemoveQueue(toast.id)
        }
      }

      return {
        ...state,
        toasts: state.toasts.map(t =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      }
    }
    case 'REMOVE_TOAST':
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter(t => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  for (const listener of listeners) {
    listener(memoryState)
  }
}

type Toast = Omit<ToasterToast, 'id'>

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: 'UPDATE_TOAST',
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: 'DISMISS_TOAST', toastId: id })

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: open => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id,
    dismiss,
    update,
  }
}

/** 壳模式：success/error(string) 转发到通知覆盖层（不写本地 store，避免 56px rail 裁剪/双份展示） */
function routeToastToNotice(variant: 'success' | 'error', message: string): boolean {
  if (typeof window === 'undefined') return false
  if (!shouldRouteToastToNotice(window.__lmView)) return false
  // fire-and-forget：主进程负责校验/缓冲；通知层不可用时不阻塞业务调用
  void window.ipcRenderer
    .invoke(IPC_CHANNELS.shell.notify, { variant, description: message })
    .catch(() => {})
  return true
}

const SHELL_NOTICE_STUB = { id: 'shell-notice', dismiss: () => {}, update: () => {} }

const toasty = {
  success: (message: string) =>
    routeToastToNotice('success', message)
      ? SHELL_NOTICE_STUB
      : toast({
          variant: 'default',
          description: message,
        }),
  error: (message: string) =>
    routeToastToNotice('error', message)
      ? SHELL_NOTICE_STUB
      : toast({
          variant: 'destructive',
          description: message,
        }),
}

function useToasts() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [])

  return {
    ...state,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  }
}

function useToast() {
  return {
    toast: toasty,
  }
}

export { useToast, useToasts }
