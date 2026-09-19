export type Page =
  | { kind: "library" }
  | { kind: "builder"; id?: string }
  | { kind: "explore"; id: string };

export function pageFromHash(hash: string): Page {
  const match = hash.match(/^#(explore|builder)\/([a-zA-Z0-9-]+)$/);
  if (match) {
    return { kind: match[1] as "explore" | "builder", id: match[2] };
  }
  if (hash === "#new") return { kind: "builder" };
  return { kind: "library" };
}

export function pageHash(page: Page): string {
  if (page.kind === "library") return "#worlds";
  if (page.kind === "builder" && !page.id) return "#new";
  return `#${page.kind}/${page.id}`;
}
