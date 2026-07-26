/*
 * Types for prepare.mjs.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Doug Compton
 *
 * Hand-written rather than generated: the module itself must stay plain ES modules with no build step,
 * because it is copied straight into the image and run by the container's node. These declarations
 * exist so `test/docker-library.test.ts` is type-checked instead of silently becoming `any`.
 */

/** 'zcode' — Parchmap can play it after wrapping. 'other' — Parchment only. */
export type StoryKind = 'zcode' | 'other'

export interface LibraryEntry {
  /** The filename as it appears in the mounted volume. */
  readonly name: string
  /** A readable title derived from the filename. */
  readonly title: string
  /** True when the file's CONTENT is a Z-machine story, so Parchmap can be offered it. */
  readonly zcode: boolean
}

export interface RefreshResult {
  readonly stories: readonly LibraryEntry[]
  readonly wrapped: readonly string[]
}

export function storyKind(buf: Uint8Array | null | undefined): StoryKind
export function titleOf(file: string): string
export function scanLibrary(): LibraryEntry[]
export function parchmapPresent(): boolean
/** The path of the wrapped copy, generating it if needed — or null if Parchmap cannot play it. */
export function ensureWrapped(name: string, library?: readonly LibraryEntry[]): string | null
export function wrapAll(library?: readonly LibraryEntry[]): string[]
export function rewriteGameList(wrapped: readonly string[]): void
export function refresh(opts?: { seed?: boolean }): RefreshResult
export function prepare(): RefreshResult
