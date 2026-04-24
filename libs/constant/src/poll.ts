/**
 * Poll numeric limits shared across DTOs, validators, and service layer.
 *
 * NOTE: The `ErrorMessage` map in `message.ts` keeps hard-coded numbers
 * (e.g. "Poll cannot have more than 20 options.") because it is declared
 * with literal string values. Keep these constants in sync with those
 * messages when limits change.
 */
export const POLL_LIMITS = {
  MIN_OPTIONS: 2,
  MAX_OPTIONS: 20,
  MAX_QUESTION_LENGTH: 500,
  MAX_OPTION_LABEL_LENGTH: 200,
  MAX_EXPIRES_IN_HOURS: 168, // 7 days
} as const;
