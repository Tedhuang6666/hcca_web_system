export const PERMISSION_DENIED_EVENT = "hcca:permission-denied";

export type PermissionDeniedDetail = {
  path: string;
  message: string;
};
