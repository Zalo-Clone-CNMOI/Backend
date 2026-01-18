import { ErrorCode } from './error-code';

/**
 * Error messages mapped to error codes
 */
export const ErrorMessage: Record<ErrorCode, string> = {
  // ============== COMMON ==============
  [ErrorCode.INTERNAL_SERVER_ERROR]:
    'Internal server error. Please try again later.',
  [ErrorCode.VALIDATION_ERROR]: 'Validation failed. Please check your input.',
  [ErrorCode.NOT_FOUND]: 'Resource not found.',
  [ErrorCode.UNAUTHORIZED]: 'Authentication required.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.BAD_REQUEST]: 'Invalid request.',
  [ErrorCode.CONFLICT]: 'Resource already exists.',
  [ErrorCode.TOO_MANY_REQUESTS]: 'Too many requests. Please try again later.',

  // ============== AUTH ==============
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'Invalid phone number or password.',
  [ErrorCode.AUTH_ACCOUNT_LOCKED]:
    'Your account has been locked. Please contact support.',
  [ErrorCode.AUTH_ACCOUNT_INACTIVE]:
    'Your account is inactive. Please contact support.',
  [ErrorCode.AUTH_TOKEN_EXPIRED]:
    'Your session has expired. Please login again.',
  [ErrorCode.AUTH_TOKEN_INVALID]: 'Invalid authentication token.',
  [ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED]:
    'Refresh token has expired. Please login again.',
  [ErrorCode.AUTH_REFRESH_TOKEN_INVALID]: 'Invalid refresh token.',
  [ErrorCode.AUTH_OTP_EXPIRED]: 'OTP has expired. Please request a new one.',
  [ErrorCode.AUTH_OTP_INVALID]: 'Invalid OTP code.',
  [ErrorCode.AUTH_TOO_MANY_ATTEMPTS]:
    'Too many login attempts. Please try again later.',

  // ============== USER ==============
  [ErrorCode.USER_NOT_FOUND]: 'User not found.',
  [ErrorCode.USER_ALREADY_EXISTS]: 'User already exists.',
  [ErrorCode.USER_PHONE_ALREADY_EXISTS]: 'Phone number is already registered.',
  [ErrorCode.USER_EMAIL_ALREADY_EXISTS]: 'Email is already registered.',
  [ErrorCode.USER_INVALID_PASSWORD]: 'Password does not meet requirements.',
  [ErrorCode.USER_CANNOT_UPDATE]: 'Cannot update user information.',

  // ============== FRIEND ==============
  [ErrorCode.FRIEND_REQUEST_NOT_FOUND]: 'Friend request not found.',
  [ErrorCode.FRIEND_REQUEST_ALREADY_EXISTS]: 'Friend request already sent.',
  [ErrorCode.FRIEND_ALREADY_FRIENDS]: 'You are already friends with this user.',
  [ErrorCode.FRIEND_CANNOT_ADD_SELF]: 'You cannot add yourself as a friend.',
  [ErrorCode.FRIEND_USER_BLOCKED]: 'This user has blocked you.',
  [ErrorCode.FRIEND_NOT_FOUND]: 'Friendship not found.',

  // ============== CONVERSATION ==============
  [ErrorCode.CONVERSATION_NOT_FOUND]: 'Conversation not found.',
  [ErrorCode.CONVERSATION_MEMBER_NOT_FOUND]:
    'Member not found in conversation.',
  [ErrorCode.CONVERSATION_PERMISSION_DENIED]:
    'You do not have permission to perform this action in this conversation.',
  [ErrorCode.CONVERSATION_ALREADY_MEMBER]:
    'User is already a member of this conversation.',
  [ErrorCode.CONVERSATION_NOT_MEMBER]:
    'You are not a member of this conversation.',
  [ErrorCode.CONVERSATION_CANNOT_LEAVE]: 'You cannot leave this conversation.',
  [ErrorCode.CONVERSATION_INVALID_TYPE]: 'Invalid conversation type.',

  // ============== MESSAGE ==============
  [ErrorCode.MESSAGE_NOT_FOUND]: 'Message not found.',
  [ErrorCode.MESSAGE_PERMISSION_DENIED]:
    'You do not have permission to perform this action on this message.',
  [ErrorCode.MESSAGE_EDIT_WINDOW_EXPIRED]:
    'Edit window has expired. Messages can only be edited within 15 minutes.',
  [ErrorCode.MESSAGE_ALREADY_DELETED]: 'Message has already been deleted.',

  // ============== POST ==============
  [ErrorCode.POST_NOT_FOUND]: 'Post not found.',
  [ErrorCode.POST_PERMISSION_DENIED]:
    'You do not have permission to perform this action on this post.',
  [ErrorCode.POST_ALREADY_DELETED]: 'Post has already been deleted.',
  [ErrorCode.POST_CONTENT_REQUIRED]: 'Post content or media is required.',

  // ============== COMMENT ==============
  [ErrorCode.COMMENT_NOT_FOUND]: 'Comment not found.',
  [ErrorCode.COMMENT_PERMISSION_DENIED]:
    'You do not have permission to perform this action on this comment.',
  [ErrorCode.COMMENT_ALREADY_DELETED]: 'Comment has already been deleted.',

  // ============== MEDIA ==============
  [ErrorCode.MEDIA_NOT_FOUND]: 'Media file not found.',
  [ErrorCode.MEDIA_UPLOAD_FAILED]: 'Failed to upload media file.',
  [ErrorCode.MEDIA_INVALID_TYPE]: 'Invalid media type.',
  [ErrorCode.MEDIA_SIZE_EXCEEDED]: 'Media file size exceeded.',
  [ErrorCode.MEDIA_PERMISSION_DENIED]:
    'You do not have permission to access this media.',

  // ============== NOTIFICATION ==============
  [ErrorCode.NOTIFICATION_NOT_FOUND]: 'Notification not found.',
  [ErrorCode.NOTIFICATION_DEVICE_NOT_FOUND]: 'Device not found.',
  [ErrorCode.NOTIFICATION_SEND_FAILED]: 'Failed to send notification.',
};

/**
 * Success messages
 */
export const SuccessMessage = {
  // ============== AUTH ==============
  AUTH_REGISTER_SUCCESS: 'Registration successful.',
  AUTH_LOGIN_SUCCESS: 'Login successful.',
  AUTH_LOGOUT_SUCCESS: 'Logout successful.',
  AUTH_REFRESH_SUCCESS: 'Token refreshed successfully.',
  AUTH_OTP_SENT: 'OTP has been sent to your phone.',
  AUTH_PASSWORD_RESET_SUCCESS: 'Password reset successful.',

  // ============== USER ==============
  USER_PROFILE_UPDATED: 'Profile updated successfully.',

  // ============== FRIEND ==============
  FRIEND_REQUEST_SENT: 'Friend request sent successfully.',
  FRIEND_REQUEST_ACCEPTED: 'Friend request accepted.',
  FRIEND_REQUEST_REJECTED: 'Friend request rejected.',
  FRIEND_BLOCKED: 'User blocked successfully.',
  FRIEND_UNBLOCKED: 'User unblocked successfully.',
  FRIEND_REMOVED: 'Friend removed successfully.',

  // ============== CONVERSATION ==============
  CONVERSATION_CREATED: 'Conversation created successfully.',
  CONVERSATION_UPDATED: 'Conversation updated successfully.',
  CONVERSATION_LEFT: 'Left conversation successfully.',
  CONVERSATION_MEMBER_ADDED: 'Member added successfully.',
  CONVERSATION_MEMBER_REMOVED: 'Member removed successfully.',
  CONVERSATION_ROLE_UPDATED: 'Role updated successfully.',

  // ============== MESSAGE ==============
  MESSAGE_SENT: 'Message sent successfully.',
  MESSAGE_UPDATED: 'Message updated successfully.',
  MESSAGE_DELETED: 'Message deleted successfully.',
  MESSAGE_READ: 'Message marked as read.',

  // ============== POST ==============
  POST_CREATED: 'Post created successfully.',
  POST_UPDATED: 'Post updated successfully.',
  POST_DELETED: 'Post deleted successfully.',
  POST_REACTED: 'Reaction added successfully.',
  POST_UNREACTED: 'Reaction removed successfully.',

  // ============== COMMENT ==============
  COMMENT_CREATED: 'Comment added successfully.',
  COMMENT_DELETED: 'Comment deleted successfully.',
  COMMENT_REACTED: 'Reaction added successfully.',
  COMMENT_UNREACTED: 'Reaction removed successfully.',

  // ============== MEDIA ==============
  MEDIA_UPLOADED: 'Media uploaded successfully.',
  MEDIA_DELETED: 'Media deleted successfully.',

  // ============== NOTIFICATION ==============
  NOTIFICATION_DEVICE_REGISTERED: 'Device registered successfully.',
  NOTIFICATION_DEVICE_REMOVED: 'Device removed successfully.',
  NOTIFICATION_PREFERENCES_UPDATED: 'Notification preferences updated.',
} as const;
