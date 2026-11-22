import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import GongwenEditor from "./GongwenEditor";

function EditorHarness({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return <GongwenEditor value={value} onChange={setValue} />;
}

function editor() {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function toolbarButton(title: string) {
  return screen.getByTitle(title);
}

describe("GongwenEditor", () => {
  it("replaces the current marker when changing levels from the toolbar", () => {
    render(<EditorHarness initialValue="" />);

    fireEvent.mouseDown(toolbarButton("套用第一層編號（一、）"));
    expect(editor().value).toBe("一、 ");

    fireEvent.mouseDown(toolbarButton("套用第二層編號（（一））"));
    expect(editor().value).toBe("　　（一） ");
  });

  it("starts a new child list at one instead of continuing another parent", () => {
    render(
      <EditorHarness
        initialValue={["一、 第一段", "　　（一） 第一小段", "　　　　1. 第一項", "　　　　2. 第二項", "　　（二） 第二小段", ""].join("\n")}
      />,
    );

    const textArea = editor();
    textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    fireEvent.mouseDown(toolbarButton("套用第三層編號（1.）"));

    expect(editor().value.endsWith("　　（二） 第二小段\n　　　　1. ")).toBe(true);
  });

  it("normalizes marker spacing when continuing a list with Enter", () => {
    const initialValue = "　　　　1.foo\n後續文字";
    render(<EditorHarness initialValue={initialValue} />);

    const textArea = editor();
    const cursor = "　　　　1.foo".length;
    textArea.setSelectionRange(cursor, cursor);
    fireEvent.keyDown(textArea, { key: "Enter" });

    expect(editor().value).toBe("　　　　1. foo\n　　　　2. \n後續文字");
  });

  it("continues the next top-level number with Enter", () => {
    render(<EditorHarness initialValue="一、 第一段" />);

    const textArea = editor();
    textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    fireEvent.keyDown(textArea, { key: "Enter" });

    expect(editor().value).toBe("一、 第一段\n二、 ");
  });

  it("indents plain text to the first level and replaces the old marker", () => {
    render(<EditorHarness initialValue="純文字" />);

    const textArea = editor();
    textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    fireEvent.keyDown(textArea, { key: "Tab" });
    expect(editor().value).toBe("一、 純文字");

    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(editor().value).toBe("　　（一） 純文字");
  });

  it("keeps indentation and numbering consistent across nested levels", () => {
    render(<EditorHarness initialValue="一、 第一段" />);

    const textArea = editor();
    textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    fireEvent.keyDown(textArea, { key: "Tab" });
    expect(editor().value).toBe("　　（一） 第一段");

    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(editor().value).toBe("　　　　1. 第一段");
  });

  it("renumbers repeated pasted markers when leaving the editor", () => {
    const initialValue = [
      "一、 第一段",
      "一、 第二段",
      "　　（一） 子項一",
      "　　（一） 子項二",
      "一、 第三段",
    ].join("\n");
    render(<EditorHarness initialValue={initialValue} />);

    fireEvent.blur(editor());

    expect(editor().value).toBe([
      "一、 第一段",
      "二、 第二段",
      "　　（一） 子項一",
      "　　（二） 子項二",
      "三、 第三段",
    ].join("\n"));
  });

  it("does not refocus the editor after a toolbar change", () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");
    render(<EditorHarness initialValue="" />);

    fireEvent.mouseDown(toolbarButton("套用第一層編號（一、）"));

    expect(focus).not.toHaveBeenCalled();
  });
});
