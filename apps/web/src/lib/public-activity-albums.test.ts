import { describe, expect, it } from "vitest";
import { galleryFingerprint, gallerySettingsValue, readActivityAlbums } from "./public-activity-albums";

describe("活動影像資料", () => {
  it("only uses the welcome selection before gallery settings have been created", () => {
    expect(readActivityAlbums({})[0].id).toBe("welcome");
    expect(readActivityAlbums(null)).toEqual([]);
    expect(readActivityAlbums({ activity_gallery: { version: 1, events: [] } })).toEqual([]);
    expect(readActivityAlbums({ activity_gallery: { version: 9, events: [] } })).toEqual([]);
  });

  it("uses the activity date and preserves individual photographer overrides and key art", () => {
    const event = readActivityAlbums({})[0];
    event.date = "2026-11-14";
    event.photographer = "活動攝影";
    event.photos[0].photographer = "指定攝影";
    event.keyVisual = { ...event.photos[0], id: "poster", photographer: "主視覺設計" };
    const [result] = readActivityAlbums({ activity_gallery: gallerySettingsValue([event]) });
    expect(result.date).toBe("2026-11-14");
    expect(result.photographer).toBe("活動攝影");
    expect(result.photos[0].photographer).toBe("指定攝影");
    expect(result.keyVisual?.photographer).toBe("主視覺設計");
    expect(result.photos[0]).not.toHaveProperty("date");
    expect(readActivityAlbums({})[0].photos[0].photographer).toBeUndefined();
  });

  it("rejects unsafe URLs, invalid image dimensions and duplicate event IDs", () => {
    const event = readActivityAlbums({})[0];
    const config = gallerySettingsValue([{ ...event, date: "2026-02-30", sourceUrl: "javascript:alert(1)",
      photos: [
        { ...event.photos[0], src: "javascript:alert(1)" },
        { ...event.photos[1], width: -1 },
        event.photos[2],
      ],
    }, event]);
    const events = readActivityAlbums({ activity_gallery: config });
    expect(events).toHaveLength(1);
    expect(events[0].photos).toHaveLength(1);
    expect(events[0].date).toBeUndefined();
    expect(events[0].sourceUrl).toBe("");
  });

  it("compares JSON content without depending on PostgreSQL object key ordering", () => {
    expect(galleryFingerprint({ events: [{ id: "welcome", title: "迎新" }], version: 1 }))
      .toBe(galleryFingerprint({ version: 1, events: [{ title: "迎新", id: "welcome" }] }));
    expect(galleryFingerprint({ events: [] })).not.toBe(galleryFingerprint({ events: [{ id: "new" }] }));
  });
});
