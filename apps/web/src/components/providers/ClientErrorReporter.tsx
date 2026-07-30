"use client";

import { useEffect } from "react";
import { installGlobalClientErrorReporter } from "@/lib/client-error-reporter";

export default function ClientErrorReporter() {
  useEffect(() => installGlobalClientErrorReporter(), []);
  return null;
}
