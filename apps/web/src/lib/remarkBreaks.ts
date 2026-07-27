type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

function preserveLineBreaks(node: MarkdownNode) {
  if (!node.children) return;

  const children: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type !== "text" || !child.value?.includes("\n")) {
      preserveLineBreaks(child);
      children.push(child);
      continue;
    }

    const lines = child.value.replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((line, index) => {
      if (index > 0) children.push({ type: "break" });
      if (line) children.push({ ...child, value: line });
    });
  }
  node.children = children;
}

/** Treat a single Markdown newline as a visible line break. */
export default function remarkBreaks() {
  return (tree: MarkdownNode) => preserveLineBreaks(tree);
}
