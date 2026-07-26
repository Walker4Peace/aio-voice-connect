import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export function maskString(str: string, visibleChars = 4) {
  if (!str) return str;
  if (str.length <= visibleChars) return "*".repeat(str.length);
  return "*".repeat(str.length - visibleChars) + str.slice(-visibleChars);
}
