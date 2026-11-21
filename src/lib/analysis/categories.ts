// Pure constants (no font engine import) so UI code can use them during server rendering.
export type Category = "sans-serif" | "serif" | "slab-serif" | "monospace" | "handwriting" | "display";
export const CATEGORIES: Category[] = ["sans-serif", "serif", "slab-serif", "monospace", "handwriting", "display"];

export const DEFAULT_REFERENCE: Record<Category, string> = {
  "sans-serif": "lato",
  serif: "notoserif",
  "slab-serif": "robotoslab",
  monospace: "robotomono",
  handwriting: "caveat",
  display: "archivoblack",
};
