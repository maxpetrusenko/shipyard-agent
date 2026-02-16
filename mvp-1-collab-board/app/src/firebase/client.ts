import type { FirebaseApp } from 'firebase/app'
import { initializeApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import { GoogleAuthProvider, getAuth } from 'firebase/auth'
import type { Database } from 'firebase/database'
import { getDatabase } from 'firebase/database'
import type { Firestore } from 'firebase/firestore'
import { enableMultiTabIndexedDbPersistence, getFirestore } from 'firebase/firestore'

import { firebaseConfig, isFirebaseConfigured, missingFirebaseEnvKeys } from '../config/env'

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let rtdb: Database | null = null

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  void enableMultiTabIndexedDbPersistence(db).catch((error) => {
    console.warn('Firestore offline persistence disabled:', error)
  })
  rtdb = getDatabase(app)
} else {
  console.warn(`Firebase env missing: ${missingFirebaseEnvKeys.join(', ')}`)
}

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export { app, auth, db, rtdb, googleProvider }
