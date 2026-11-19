/** 路徑一律加上部署 base（GitHub Pages 為 /bizcard/）。 */
export const BASE = import.meta.env.BASE_URL;
export const to = (p: string): string => BASE + p.replace(/^\//, '');
