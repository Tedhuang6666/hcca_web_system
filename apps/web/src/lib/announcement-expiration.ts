type AnnouncementExpirationFields = {
  is_urgent: boolean;
  is_published: boolean;
  urgent_until: string | null;
};

export function isAnnouncementExpired(
  announcement: AnnouncementExpirationFields,
  now: number = Date.now(),
): boolean {
  if (
    !announcement.is_published ||
    !announcement.is_urgent ||
    !announcement.urgent_until
  ) {
    return false;
  }

  const deadline = Date.parse(announcement.urgent_until);
  return Number.isFinite(deadline) && deadline <= now;
}
