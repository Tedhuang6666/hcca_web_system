import type { PublicLinkCategoryOut, PublicLinkOut } from "@/lib/types";

export type PublicLinkGroup = {
  id: string;
  title: string;
  links: PublicLinkOut[];
};

export function groupPublicLinks(
  categories: Pick<PublicLinkCategoryOut, "id" | "title">[],
  links: PublicLinkOut[],
): PublicLinkGroup[] {
  const knownCategoryIds = new Set(categories.map((category) => category.id));
  const groups: PublicLinkGroup[] = categories.flatMap((category) => {
    const categoryLinks = links.filter((link) => link.category_id === category.id);
    return categoryLinks.length > 0
      ? [{ id: category.id, title: category.title, links: categoryLinks }]
      : [];
  });

  const extraGroups = new Map<string, PublicLinkGroup>();
  const unassigned: PublicLinkOut[] = [];
  for (const link of links) {
    if (!link.category_id) {
      unassigned.push(link);
      continue;
    }
    if (knownCategoryIds.has(link.category_id)) continue;

    const group = extraGroups.get(link.category_id) ?? {
      id: link.category_id,
      title: link.category?.title ?? "其他連結",
      links: [],
    };
    group.links.push(link);
    extraGroups.set(group.id, group);
  }
  groups.push(...extraGroups.values());
  if (unassigned.length > 0) {
    groups.push({ id: "uncategorized", title: "其他連結", links: unassigned });
  }
  return groups;
}
