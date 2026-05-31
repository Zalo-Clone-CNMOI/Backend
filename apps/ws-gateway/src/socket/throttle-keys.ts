/**
 * Redis key builders for ws-gateway anti-spam, shared between the send gate
 * (ChatHandler) and the strike recorder (AiFanoutConsumer) so the cooldown key
 * written by one is the same key read by the other.
 */
export const messageRateKey = (userId: string): string => `rate:msg:${userId}`;
export const moderationStrikeKey = (userId: string): string =>
  `mod:strikes:${userId}`;
export const moderationCooldownKey = (userId: string): string =>
  `mod:cooldown:${userId}`;
