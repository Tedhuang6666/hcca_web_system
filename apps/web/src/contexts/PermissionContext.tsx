"use client";
import { createContext, useContext, useMemo, ReactNode } from "react";

export interface PermissionContextType {
  can: (permission: string, orgId?: string) => boolean;
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export function PermissionProvider({
  children,
  can,
}: {
  children: ReactNode;
  can: (permission: string, orgId?: string) => boolean;
}) {
  const value = useMemo(() => ({ can }), [can]);
  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissionContext(): PermissionContextType {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error("usePermissionContext must be used within PermissionProvider");
  }
  return context;
}
