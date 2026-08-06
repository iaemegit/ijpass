import axios from 'axios';

export type PortalUser = { id: number; name: string; email: string; organization?: string | null; role: 'SUPER_ADMIN' | 'INTERNAL_USER' | 'PUBLISHER'; permissions?: string[] };
export const api = axios.create({ baseURL: '/api' });
export const getToken = () => localStorage.getItem('ijpass_token') || sessionStorage.getItem('ijpass_token');
export const saveSession = (token: string, user: PortalUser, remember = false) => {
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem('ijpass_token', token);
  storage.setItem('ijpass_user', JSON.stringify(user));
};
export const clearSession = () => { localStorage.removeItem('ijpass_token'); localStorage.removeItem('ijpass_user'); sessionStorage.removeItem('ijpass_token'); sessionStorage.removeItem('ijpass_user'); };
api.interceptors.request.use(config => { const token = getToken(); if (token) config.headers.Authorization = `Bearer ${token}`; return config; });
