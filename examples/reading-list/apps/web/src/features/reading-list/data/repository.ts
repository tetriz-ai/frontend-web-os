import type { Item, ItemPatch, NewItem } from './types';

/**
 * The contract's operations (packages/api-contract/openapi.yaml). Local mode implements them over
 * browser storage; a real backend would implement them over fetch. Components never see which.
 */
export interface ReadingListRepository {
  /** listItems: every saved link, newest first. */
  listItems(): Promise<Item[]>;
  /** createItem: save a link; a blank title becomes the hostname. */
  createItem(input: NewItem): Promise<Item>;
  /** updateItem: mark a link read or unread. */
  updateItem(id: string, patch: ItemPatch): Promise<Item>;
  /** deleteItem: delete a link for good. */
  deleteItem(id: string): Promise<void>;
}

/** The reason storage-backed operations fail; the same text as fixtures/listItems.unavailable.json (503). */
export const STORAGE_UNAVAILABLE =
  "This browser isn't letting the app use its storage, so your list can't be read. Allow site data for this page (private windows often block it), then try again.";

/** A link the list no longer has (updateItem and deleteItem 404). */
export const ITEM_MISSING = "That link isn't in your list any more. Reload the page to see the latest list.";
