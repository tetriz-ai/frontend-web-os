// The types of packages/api-contract/openapi.yaml (components.schemas). The local repository and
// any future HTTP repository both speak these, so a backend swap changes no component.

/** A saved link. */
export interface Item {
  id: string;
  /** An http or https address. */
  url: string;
  /** Never blank: defaults to the hostname. */
  title: string;
  /** ISO 8601, UTC. */
  savedAt: string;
  read: boolean;
}

/** createItem's request body. */
export interface NewItem {
  url: string;
  /** Optional; blank means "use the hostname". */
  title?: string;
}

/** updateItem's request body. */
export interface ItemPatch {
  read: boolean;
}
