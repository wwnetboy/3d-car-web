import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@/styles/globals.css'
import './style.css'
import './ui.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { App } from './ui/app'
import { initializeStudio } from './controller'

flushSync(() => createRoot(document.getElementById('interface')!).render(createElement(App)))
initializeStudio()
