/*
 * Types for library.mjs.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * See prepare.d.mts for why these are hand-written.
 */
import type { Server } from 'node:http'

export interface LibraryStory {
  readonly name: string
  readonly title: string
  /** Which bundled players can take this story: always 'parchment', plus 'parchmap' when wrappable. */
  readonly players: readonly string[]
}

export interface LibraryPayload {
  /** False in an image built with WITH_PARCHMAP=0. */
  readonly parchmap: boolean
  readonly stories: readonly LibraryStory[]
}

/**
 * The subset of node's req/res the handler touches, so a test can drive it with no socket. Deliberately
 * narrow: anything wider would make the test's stub the thing under test.
 */
export interface LibraryRequest {
  readonly url?: string | undefined
  readonly method?: string | undefined
}

export interface LibraryResponse {
  headersSent: boolean
  writeHead(status: number, headers: Record<string, string>): unknown
  end(body?: Uint8Array | string): unknown
}

export function libraryPayload(): LibraryPayload
export function handleLibraryRequest(req: LibraryRequest, res: LibraryResponse): void
/** Starts the loopback-only helper. Returns null when it could not be created. */
export function startLibraryServer(): Server | null
