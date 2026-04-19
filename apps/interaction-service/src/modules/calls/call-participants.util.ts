export function uniqueParticipants(
  initiatorId: string,
  participantIds?: string[],
): string[] {
  const ids = new Set<string>([initiatorId]);
  for (const participantId of participantIds ?? []) {
    if (participantId && participantId.trim() !== '') {
      ids.add(participantId);
    }
  }
  return Array.from(ids);
}
