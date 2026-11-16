"use client";

import { useSyncExternalStore } from "react";
import { formatSavedAt } from "@/lib/register";

const subscribe = () => () => {};

/** A saved timestamp in the viewer's time zone. The server has no viewer zone, so it renders UTC. */
export function LocalTime({ value }: { value: string }) {
  const text = useSyncExternalStore(subscribe, () => formatSavedAt(value), () => formatSavedAt(value, "UTC"));
  return <time dateTime={value}>{text}</time>;
}
