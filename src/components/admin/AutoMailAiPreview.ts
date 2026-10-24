import { createContext } from 'react';

// The suggestion is displayed inside the composer, outside its editable HTML.
// It becomes part of a saved/sent reply only after explicit insertion.
export const AutoMailAiPreview = createContext<{
  target: HTMLDivElement | null;
  setPending: (pending: boolean) => void;
} | null>(null);
