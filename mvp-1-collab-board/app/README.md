# CollabBoard MVP-1 App

Realtime collaborative whiteboard MVP using React + TypeScript + Firebase.

## MVP Features Implemented
- Google auth (Firebase Auth)
- Board route sharing (`/b/:boardId`)
- Infinite board with pan + zoom
- Sticky notes + rectangle shapes
- Create, move, edit objects with Firestore sync
- Multiplayer cursors and presence with Realtime Database
- Keyboard object ops:
  - delete (`Delete`/`Backspace`)
  - duplicate (`Cmd/Ctrl + D`)
  - copy/paste (`Cmd/Ctrl + C` / `Cmd/Ctrl + V`)
- AI command panel wired to backend dispatcher endpoint (`/api/ai/command`)

## Local Setup
1. Install deps:
```bash
npm install
```

2. Create env file:
```bash
cp .env.example .env
```

3. Fill `.env`:
```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_DATABASE_URL=
VITE_DEFAULT_BOARD_ID=mvp-demo-board
```

4. Run dev server:
```bash
npm run dev
```

## Build
```bash
npm run build
```

## Deploy (Firebase Hosting)
From `mvp-1-collab-board/`:
1. Set project in `.firebaserc` (copy from `.firebaserc.example`).
2. Build app:
```bash
cd app && npm run build
```
3. Deploy:
```bash
cd ..
firebase deploy --only hosting,functions
```

## Security
- `.env` and `.env.*` are ignored by git.
- Use `.env.example` for shared config shape only.
- Never commit service credentials or PAT tokens.
