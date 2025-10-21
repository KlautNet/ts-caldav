function normalizeSlashEnd(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

function first<T>(val: T | T[] | undefined): T | undefined {
  return Array.isArray(val) ? val[0] : val;
}

export { normalizeSlashEnd, first };
