import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-code';

/**
 * HTTP status codes mapped to error codes
 */
export const ErrorHttpStatus: Record<ErrorCode, HttpStatus> = {
  // ============== COMMON ==============
  [ErrorCode.INTERNAL_SERVER_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.TOO_MANY_REQUESTS]: HttpStatus.TOO_MANY_REQUESTS,

  // ============== AUTH ==============
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AUTH_ACCOUNT_LOCKED]: HttpStatus.FORBIDDEN,
  [ErrorCode.AUTH_ACCOUNT_INACTIVE]: HttpStatus.FORBIDDEN,
  [ErrorCode.AUTH_TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AUTH_TOKEN_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AUTH_REFRESH_TOKEN_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AUTH_OTP_EXPIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.AUTH_OTP_INVALID]: HttpStatus.BAD_REQUEST,
  [ErrorCode.AUTH_TOO_MANY_ATTEMPTS]: HttpStatus.TOO_MANY_REQUESTS,

  // ============== USER ==============
  [ErrorCode.USER_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.USER_ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.USER_PHONE_ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.USER_EMAIL_ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.USER_INVALID_PASSWORD]: HttpStatus.BAD_REQUEST,
  [ErrorCode.USER_CANNOT_UPDATE]: HttpStatus.BAD_REQUEST,

  // ============== FRIEND ==============
  [ErrorCode.FRIEND_REQUEST_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.FRIEND_REQUEST_ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.FRIEND_ALREADY_FRIENDS]: HttpStatus.CONFLICT,
  [ErrorCode.FRIEND_CANNOT_ADD_SELF]: HttpStatus.BAD_REQUEST,
  [ErrorCode.FRIEND_USER_BLOCKED]: HttpStatus.FORBIDDEN,
  [ErrorCode.FRIEND_NOT_FOUND]: HttpStatus.NOT_FOUND,

  // ============== CONVERSATION ==============
  [ErrorCode.CONVERSATION_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONVERSATION_MEMBER_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONVERSATION_PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [ErrorCode.CONVERSATION_ALREADY_MEMBER]: HttpStatus.CONFLICT,
  [ErrorCode.CONVERSATION_NOT_MEMBER]: HttpStatus.FORBIDDEN,
  [ErrorCode.CONVERSATION_CANNOT_LEAVE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.CONVERSATION_INVALID_TYPE]: HttpStatus.BAD_REQUEST,

  // ============== MESSAGE ==============
  [ErrorCode.MESSAGE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.MESSAGE_PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [ErrorCode.MESSAGE_EDIT_WINDOW_EXPIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.MESSAGE_ALREADY_DELETED]: HttpStatus.BAD_REQUEST,

  // ============== POST ==============
  [ErrorCode.POST_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.POST_PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [ErrorCode.POST_ALREADY_DELETED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.POST_CONTENT_REQUIRED]: HttpStatus.BAD_REQUEST,

  // ============== COMMENT ==============
  [ErrorCode.COMMENT_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.COMMENT_PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [ErrorCode.COMMENT_ALREADY_DELETED]: HttpStatus.BAD_REQUEST,

  // ============== MEDIA ==============
  [ErrorCode.MEDIA_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.MEDIA_UPLOAD_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.MEDIA_INVALID_TYPE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.MEDIA_SIZE_EXCEEDED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.MEDIA_PERMISSION_DENIED]: HttpStatus.FORBIDDEN,

  // ============== NOTIFICATION ==============
  [ErrorCode.NOTIFICATION_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.NOTIFICATION_DEVICE_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.NOTIFICATION_SEND_FAILED]: HttpStatus.INTERNAL_SERVER_ERROR,

  // ============== QR LOGIN ==============
  [ErrorCode.QR_SESSION_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.QR_SESSION_EXPIRED]: HttpStatus.GONE,
  [ErrorCode.QR_SESSION_ALREADY_PROCESSED]: HttpStatus.CONFLICT,
  [ErrorCode.QR_SESSION_INVALID]: HttpStatus.BAD_REQUEST,
};
