// The fetch seam: manual-paste parsing (format contract), deterministic
// manual refs, fixture mode, and the documented live stub.

import { describe, expect, it } from 'vitest';
import {
  FixtureFetcher,
  LiveAdLibraryFetcher,
  ManualPasteFetcher,
  manualRef,
  parsePastedAds,
} from '../fetcher';
import { E1, E2 } from './fixtures';

describe('parsePastedAds — the paste format', () => {
  it('splits one ad per paragraph (blank-line separated)', () => {
    const ads = parsePastedAds(
      'השתלת שיניים ב-12 תשלומים ללא ריבית\n\nיישור שיניים שקוף — בדיקה ראשונה חינם',
    );
    expect(ads).toHaveLength(2);
    expect(ads[0].text).toBe('השתלת שיניים ב-12 תשלומים ללא ריבית');
    expect(ads[1].text).toBe('יישור שיניים שקוף — בדיקה ראשונה חינם');
    expect(ads.every((a) => a.still_active)).toBe(true);
  });

  it('supports --- as a separator and skips empty blocks', () => {
    const ads = parsePastedAds('מודעה ראשונה\n---\n\n---\nמודעה שנייה');
    expect(ads.map((a) => a.text)).toEqual(['מודעה ראשונה', 'מודעה שנייה']);
  });

  it('parses leading metadata lines (English keys)', () => {
    const ads = parsePastedAds(
      'format: video\nplatforms: facebook, instagram\nlanding: https://example.co.il/lp\nfirst_seen: 2026-03-01\nמבצע השתלות — 12 תשלומים',
    );
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({
      format:       'video',
      platforms:    ['facebook', 'instagram'],
      landing_url:  'https://example.co.il/lp',
      first_seen:   '2026-03-01',
      text:         'מבצע השתלות — 12 תשלומים',
      still_active: true,
    });
  });

  it('parses Hebrew metadata keys, including סטטוס: לא פעיל', () => {
    const ads = parsePastedAds(
      'פורמט: קרוסלה\nמתאריך: 2026-05-01\nסטטוס: לא פעיל\nנותרו 3 מקומות אחרונים למבצע ההלבנה!',
    );
    expect(ads[0]).toMatchObject({
      format:       'קרוסלה',
      first_seen:   '2026-05-01',
      still_active: false,
    });
  });

  it('metadata parsing STOPS at the first non-meta line — colons inside ad copy survive', () => {
    const ads = parsePastedAds('format: image\nשימו לב: המבצע מסתיים\nלינק: לא-מטא-דאטה');
    expect(ads[0].format).toBe('image');
    expect(ads[0].text).toBe('שימו לב: המבצע מסתיים\nלינק: לא-מטא-דאטה');
    expect(ads[0].landing_url).toBeUndefined();
  });

  it('an invalid first_seen date is ignored rather than stored malformed', () => {
    const ads = parsePastedAds('first_seen: 01/03/2026\nטקסט מודעה');
    expect(ads[0].first_seen).toBeUndefined();
  });
});

describe('manual refs — deterministic and whitespace-tolerant', () => {
  it('has the manual:<sha256-12> shape', () => {
    expect(manualRef('טקסט')).toMatch(/^manual:[0-9a-f]{12}$/);
  });

  it('the same ad re-pasted with different wrapping/spacing gets the SAME ref (idempotent upsert key)', () => {
    const a = parsePastedAds('השתלת שיניים ב-12 תשלומים   ללא ריבית')[0];
    const b = parsePastedAds('השתלת שיניים\nב-12 תשלומים ללא ריבית')[0];
    expect(a.ref).toBeDefined();
    expect(a.ref).toBe(b.ref);
  });

  it('different ad texts get different refs', () => {
    expect(manualRef('מודעה א')).not.toBe(manualRef('מודעה ב'));
  });

  it('parsing is fully deterministic (same input → identical output)', () => {
    const input = 'format: video\nמודעה ראשונה\n\nמודעה שנייה';
    expect(parsePastedAds(input)).toEqual(parsePastedAds(input));
  });
});

describe('fetcher implementations', () => {
  it('ManualPasteFetcher returns the parse as a manual_paste FetchResult', async () => {
    const fetcher = new ManualPasteFetcher('מודעה אחת\n\nמודעה שתיים');
    const result = await fetcher.fetch(E1);
    expect(result.source).toBe('manual_paste');
    expect(result.ads).toHaveLength(2);
  });

  it('FixtureFetcher serves canned ads per entity id (empty for unknown entities)', async () => {
    const fetcher = new FixtureFetcher({
      [E1.id]: [{ ref: 'r1', text: 'מודעה', still_active: true }],
    });
    expect((await fetcher.fetch(E1)).ads).toHaveLength(1);
    expect((await fetcher.fetch(E2)).ads).toHaveLength(0);
  });

  it('LiveAdLibraryFetcher is a documented stub that rejects', async () => {
    await expect(new LiveAdLibraryFetcher().fetch(E1)).rejects.toThrow(/not implemented/);
  });
});
