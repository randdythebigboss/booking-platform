# 0001 - One Expo codebase for iOS, Android and web

**Date:** 2026-09-19
**Status:** Accepted

## Context

The product must reach customers on the web without an install, and reach
professionals on their phones. Three codebases would triple the cost of every
feature at the exact moment the product is least certain.

## Decision

One Expo + Expo Router codebase targets iOS, Android, web and PWA.

Applications are split only when there is a real business or technical reason,
not on principle.

## Consequences

The public booking page is a static web route, so a customer opens a link and
books. Nothing is installed.

Expo Router file routes are the same on every platform, so the route map in
PRODUCT.md is literally the directory structure.

The cost is that platform-specific work needs `.web.tsx`/`.native.tsx`
splits. Phase 0 needed exactly one such consideration: session storage in
`src/lib/supabase.ts`.
