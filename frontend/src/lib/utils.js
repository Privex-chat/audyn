import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function getApiError(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (Array.isArray(e.loc) ? `${e.loc.slice(-1)[0]}: ${e.msg}` : e.msg)).join(', ');
  if (typeof detail === 'object') return JSON.stringify(detail);
  return fallback;
}
