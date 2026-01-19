/**
 * JWT Payload interface
 */
export interface JwtPayload {
  sub: string; // User ID
  phone: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

/**
 * Authenticated user interface (attached to request)
 */
export interface AuthenticatedUser {
  id: string;
  phone: string;
  email?: string;
  fullName: string;
  avatarUrl?: string;
  status: string;
}

/**
 * Token pair response
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

/**
 * Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
