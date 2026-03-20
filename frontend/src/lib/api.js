import axios from 'axios';

const API_BASE = process.env.REACT_APP_BACKEND_URL || 'https://api.audyn.com';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

const TOKEN_KEY = 'audyn_token';
const GUEST_KEY = 'audyn_guest_id';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getGuestId() {
  return localStorage.getItem(GUEST_KEY);
}

export function setGuestId(id) {
  if (id) {
    localStorage.setItem(GUEST_KEY, id);
  } else {
    localStorage.removeItem(GUEST_KEY);
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GUEST_KEY);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {

      console.warn('Auth token expired or invalid');
    }
    return Promise.reject(error);
  }
);

export default api;
