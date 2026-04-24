// Auth API DTOs — request/response shapes for auth endpoints
import type { User } from '../domain/user.js';

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  displayName: string;
}

export interface AuthTokenDto {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
}

export interface SessionDto {
  user: User;
  token: AuthTokenDto;
}
