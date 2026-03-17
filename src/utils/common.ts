export const normalizeSlashEnd = (u: string) => {
  return u.endsWith("/") ? u.slice(0, -1) : u;
};

export const first = <T>(val: T | T[] | undefined): T | undefined => {
  return Array.isArray(val) ? val[0] : val;
};
