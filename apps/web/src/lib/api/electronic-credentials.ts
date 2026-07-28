import { get } from "./core";
import type { ElectronicCredentialOut } from "@/lib/types";

export const electronicCredentialsApi = {
  me: () => get<ElectronicCredentialOut>("/electronic-credentials/me"),
};
