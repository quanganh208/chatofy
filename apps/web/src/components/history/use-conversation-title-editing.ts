'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ConversationSummary } from '@chatofy/types';
import { renameConversation } from '@/clients/api-client';
import { useHistoryPanes } from './history-panes-context';

interface TitleEditingInput {
  conversationId: string;
  /** The conversation has loaded, so its header can show a field. */
  loaded: boolean;
  /** It turned out not to exist. */
  missing: boolean;
  /** The title, which takes focus back when the field goes. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Fold the stored summary into the conversation on screen. */
  onRenamed: (stored: ConversationSummary) => void;
}

/**
 * Whether the open conversation's title is a field, and the rename it saves.
 *
 * Editing starts from the header's own menu, or from a list row's — the row opened
 * this conversation and left a request in the History layout for its header.
 */
export function useConversationTitleEditing({
  conversationId,
  loaded,
  missing,
  headingRef,
  onRenamed,
}: TitleEditingInput) {
  const panes = useHistoryPanes();
  const [editing, setEditing] = useState(false);

  // A different conversation never inherits the previous one's open field.
  const [editingFor, setEditingFor] = useState(conversationId);
  if (editingFor !== conversationId) {
    setEditingFor(conversationId);
    setEditing(false);
  }

  // Rename chosen on this conversation's list row: the row opened it, and its
  // header does the editing. Adjusted during render, so the title never draws one
  // frame before the field replaces it; the request is spent once editing is on.
  const renameRequested = panes?.renameRequest === conversationId;
  if (loaded && renameRequested && !editing) setEditing(true);
  // Spent too when the conversation turns out to be gone: left pending, it would
  // open the editor unasked the next time this conversation is opened.
  useEffect(() => {
    if (renameRequested && (editing || missing)) panes?.takeRenameRequest();
  }, [editing, missing, renameRequested, panes]);

  // Back onto the title when the field goes, whichever way it went — the control
  // that had focus is gone with it.
  const returnToTitle = useRef(false);
  useEffect(() => {
    if (editing || !returnToTitle.current) return;
    returnToTitle.current = false;
    headingRef.current?.focus();
  }, [editing, headingRef]);

  const stopEditing = () => {
    returnToTitle.current = true;
    setEditing(false);
  };

  const rename = async (title: string) => {
    const { conversation: stored } = await renameConversation(conversationId, { title });
    // The header from the stored summary, the turns from what is already there; the
    // list row and the export cache take the same summary, so nothing refetches.
    onRenamed(stored);
    panes?.renamed(stored);
    stopEditing();
  };

  return { editing, startEditing: () => setEditing(true), stopEditing, rename };
}
