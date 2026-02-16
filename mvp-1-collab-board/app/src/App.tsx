import { Navigate, Route, Routes } from 'react-router-dom'

import { defaultBoardId } from './config/env'
import { LoginPage } from './pages/LoginPage'
import { BoardPage } from './pages/BoardPage'
import { useAuth } from './state/AuthContext'

const App = () => {
  const { loading } = useAuth()

  if (loading) {
    return (
      <main className="loading-shell">
        <p>Loading session...</p>
      </main>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/b/:boardId" element={<BoardPage />} />
      <Route path="*" element={<Navigate to={`/b/${defaultBoardId}`} replace />} />
    </Routes>
  )
}

export default App
