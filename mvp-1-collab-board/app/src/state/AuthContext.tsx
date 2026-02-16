/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'

import { missingFirebaseEnvKeys } from '../config/env'
import { auth, googleProvider } from '../firebase/client'

type AuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  configError: string | null
  signInWithGoogle: () => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const firebaseConfigError =
  missingFirebaseEnvKeys.length > 0
    ? `Missing Firebase env keys: ${missingFirebaseEnvKeys.join(', ')}`
    : null

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => Boolean(auth))

  useEffect(() => {
    if (!auth) {
      return
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })

    return unsubscribe
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured: Boolean(auth),
      configError: firebaseConfigError,
      signInWithGoogle: async () => {
        if (!auth) {
          throw new Error(firebaseConfigError || 'Firebase auth is not configured')
        }
        await signInWithPopup(auth, googleProvider)
      },
      signOutUser: async () => {
        if (!auth) {
          return
        }
        await signOut(auth)
      },
    }),
    [loading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return ctx
}
