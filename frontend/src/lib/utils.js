import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function getApiError(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === 'string') {
    // Map legacy string errors to friendly messages
    if (detail.includes('None of the provided track IDs are playable') || detail.includes('playable')) {
      return 'No tracks have audio previews ready yet. Previews are still loading in the background. Please try again in a moment.';
    }
    if (detail.includes('playlist_id required')) {
      return 'Please select a playlist first.';
    }
    return detail;
  }
  if (Array.isArray(detail))
    return detail.map((e) => (Array.isArray(e.loc) ? `${e.loc.slice(-1)[0]}: ${e.msg}` : e.msg)).join(', ');
  if (typeof detail === 'object') {
    // Handle new detailed error format from /sessions/start
    if (detail.playable_count !== undefined) {
      const { playable_count, total_in_playlist, pending_count, message } = detail;
      if (playable_count === 0 && pending_count > 0) {
        return `No tracks have audio previews ready yet. ${pending_count} previews are still loading in the background. Please wait a moment and try again.`;
      }
      if (playable_count === 0) {
        return `None of the ${total_in_playlist} tracks in this playlist have audio previews available on Spotify. Try a different playlist.`;
      }
      return message || `Only ${playable_count} of ${total_in_playlist} tracks are playable right now.`;
    }
    return JSON.stringify(detail);
  }
  return fallback;
}
