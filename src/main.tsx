import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SessionGate } from './Session'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionGate>
      <App />
    </SessionGate>
  </React.StrictMode>,
)
