import type {
  OrgRead,
} from "../types";
import { get, patch } from "./core";

// ── 組織（公開端點）───────────────────────────────────────────────────────────

export type { OrgRead } from "../types";

export const orgsApi = {
  list: (params?: { active_only?: boolean; exclude_class_orgs?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.active_only !== undefined) query.set("active_only", String(params.active_only));
    if (params?.exclude_class_orgs !== undefined) {
      query.set("exclude_class_orgs", String(params.exclude_class_orgs));
    }
    const qs = query.toString();
    return get<OrgRead[]>(`/orgs${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<OrgRead>(`/orgs/${id}`),
  /** 取得組織樹（巢狀結構） */
  tree: () => get<(OrgRead & { children: OrgRead[] })[]>("/orgs/tree"),
  /** 取得當前使用者有 document:create 或 document:draft 權限的組織列表（RBAC 過濾） */
  myCreateOrgs: () => get<OrgRead[]>("/orgs/my-create-orgs"),
  /** 取得當前使用者有 regulation:create 權限的組織列表（RBAC 過濾） */
  myRegulationCreateOrgs: () => get<OrgRead[]>("/orgs/my-regulation-create-orgs"),
  /** 取得當前使用者有 serial:create 權限的組織列表（RBAC 過濾） */
  mySerialTemplateOrgs: () => get<OrgRead[]>("/orgs/my-serial-template-orgs"),
  /** 更新組織資訊（需 org:manage 或 admin:all 權限） */
  updateOrg: (id: string, data: {
    prefix?: string | null;
    name?: string;
    description?: string | null;
    parent_id?: string | null;
    leader_user_id?: string | null;
    note?: string | null;
    remark?: string | null;
    is_active?: boolean;
  }) =>
    patch<OrgRead>(`/orgs/${id}`, data),
};
