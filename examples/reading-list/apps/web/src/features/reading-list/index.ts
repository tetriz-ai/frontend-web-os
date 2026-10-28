// The reading-list feature's public entry: other code imports only this file (docs/app/modules.json).
export { checkLink } from './model/link';
export { READING_LIST_STORAGE_KEY, createLocalRepository, type StorageLike } from './data/local-repository';
export type { ReadingListRepository } from './data/repository';
export type { Item, ItemPatch, NewItem } from './data/types';
export { ReadingListPage, type ReadingListPageProps } from './components/reading-list-page';
export { ReadingListView, type ReadingListViewProps } from './components/reading-list-view';
