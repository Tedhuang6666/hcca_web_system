import type {
  LineBindingOut, LineLinkCodeOut,
} from "../types";
import { get, post, del } from "./core";

export const lineApi = {
  me: () => get<LineBindingOut>("/line/me"),
  createLinkCode: () => post<LineLinkCodeOut>("/line/link-code", {}),
  unlink: () => del<void>("/line/me"),
};
