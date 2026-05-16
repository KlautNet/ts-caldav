export type ItemRef = {
  href: string;
  etag: string;
};

export type RefDiff = {
  newItems: string[];
  updatedItems: string[];
  deletedItems: string[];
};

export const diffRefs = (remoteRefs: ItemRef[], localRefs: ItemRef[]): RefDiff => {
  const localMap = new Map(localRefs.map((i) => [i.href, i.etag]));
  const remoteMap = new Map(remoteRefs.map((i) => [i.href, i.etag]));

  const newItems: string[] = [];
  const updatedItems: string[] = [];
  const deletedItems: string[] = [];

  for (const { href, etag } of remoteRefs) {
    if (!localMap.has(href)) newItems.push(href);
    else if (localMap.get(href) !== etag) updatedItems.push(href);
  }

  for (const { href } of localRefs) {
    if (!remoteMap.has(href)) deletedItems.push(href);
  }

  return { newItems, updatedItems, deletedItems };
};

