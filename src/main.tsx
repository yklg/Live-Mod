import './lib/wdyr'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './router'
import './index.css'
import { initTheme } from './hooks/useTheme'
import { autoCleanupStorage } from './utils/storage'

autoCleanupStorage()
initTheme()

ReactDOM.createRoot(document.getElementById('root') ?? document.createElement('div')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
