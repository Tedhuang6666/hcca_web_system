"use client";

import { createContext, useContext } from "react";

const PeopleManagementEmbedContext = createContext(false);

export function PeopleManagementEmbedProvider({ children }: { children: React.ReactNode }) {
  return (
    <PeopleManagementEmbedContext.Provider value>
      {children}
    </PeopleManagementEmbedContext.Provider>
  );
}

export function usePeopleManagementEmbed() {
  return useContext(PeopleManagementEmbedContext);
}
