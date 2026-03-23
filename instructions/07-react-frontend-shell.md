Build the React + Vite + TailwindCSS frontend shell for Ship. This is the application layout with navigation, routing, auth context, and data-fetching infrastructure. Do not implement individual page content yet; focus on the shell that all pages render inside.

Set up the web package: Vite with React plugin, TailwindCSS with PostCSS, TypeScript, path alias `@/` pointing to `src/`. Create `src/main.tsx` with React Router, TanStack Query provider (with devtools), and the root route structure.

Create `src/hooks/useAuth.tsx`: auth context with login/logout/user state, fetches GET /api/auth/me on mount, stores session, provides `useAuth()` hook returning user/logout/isSuperAdmin. Create `src/contexts/WorkspaceContext.tsx` for current workspace and workspace switching. Create `src/lib/api.ts` as the shared fetch wrapper that auto-includes credentials, handles CSRF token (fetches from /api/csrf-token and attaches X-CSRF-Token header on mutations), and returns typed responses.

Create `src/pages/App.tsx` (the AppLayout component): icon rail on the left (48px wide) with mode icons for Dashboard/Docs/Programs/Projects/Teams/Settings, workspace switcher dropdown at top, user avatar with logout at bottom. Collapsible left sidebar (224px) showing context-specific lists (documents tree, issues list, projects list, programs list, team sidebar) based on active mode. Main content area renders `<Outlet />`. Wire up Cmd+K for command palette (stub). Add session timeout modal via `useSessionTimeout` hook. Include `<ErrorBoundary>` around the main content. Use semantic HTML landmarks: `<nav>` for rail, `<aside>` for sidebar, `<main>` for content.

Create `src/components/ProtectedRoute.tsx` that redirects to /login if not authenticated. Create `src/pages/Login.tsx` with email/password form, CSRF token handling, and redirect to /docs on success. Set up routes: /login (public), / (protected, renders AppLayout with children: /docs, /documents/:id, /issues, /projects, /programs, /team/*, /settings, /dashboard, /my-week).

Create data contexts: `src/contexts/DocumentsContext.tsx` (TanStack Query for documents list, createDocument/updateDocument/deleteDocument mutations), `src/contexts/IssuesContext.tsx`, `src/contexts/ProgramsContext.tsx`, `src/contexts/ProjectsContext.tsx` following the same pattern.

Verify: run `pnpm dev`, navigate to localhost:5173, see login page, log in with seeded user, confirm icon rail + sidebar + main content area render, confirm switching modes updates the sidebar, confirm Cmd+K opens command palette stub, confirm logout redirects to login.
