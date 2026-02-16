import { Navigate } from 'react-router-dom'

import { defaultBoardId } from '../config/env'
import { useAuth } from '../state/AuthContext'

export const LoginPage = () => {
  const { user, signInWithGoogle, loading, configError, configured } = useAuth()

  if (user) {
    return <Navigate to={`/b/${defaultBoardId}`} replace />
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <h1>CollabBoard MVP-1</h1>
        <p>Sign in to join realtime collaboration and cursor presence.</p>
        {configError && <p className="error-text">{configError}</p>}
        <button
          type="button"
          className="primary-button"
          disabled={loading || !configured}
          onClick={() => void signInWithGoogle()}
        >
          Sign in with Google
        </button>
      </section>
    </main>
  )
}
