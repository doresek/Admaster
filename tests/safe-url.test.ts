// Unit tests for the URL sanitizers guarding the public landing-page sinks
// (finding S2 — stored XSS via cta_href / video_url).
import { describe, it, expect } from 'vitest';
import { safeExternalUrl, safeEmbedUrl } from '../lib/safe-url';

describe('safeExternalUrl', () => {
  it('neutralizes javascript: URLs to #', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBe('#');
  });

  it('neutralizes protocol-relative //evil.com to #', () => {
    expect(safeExternalUrl('//evil.com')).toBe('#');
  });

  it('passes through https URLs', () => {
    expect(safeExternalUrl('https://ok.com')).toBe('https://ok.com/');
  });

  it('neutralizes whitespace/case tricks like \\tjavascript:', () => {
    expect(safeExternalUrl('\tjavascript:alert(1)')).toBe('#');
    expect(safeExternalUrl('  JavaScript:alert(1)')).toBe('#');
  });

  it('neutralizes data: URLs to #', () => {
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });

  it('allows mailto: and tel:', () => {
    expect(safeExternalUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeExternalUrl('tel:+15551234')).toBe('tel:+15551234');
  });

  it('neutralizes non-string / empty input to #', () => {
    expect(safeExternalUrl(null)).toBe('#');
    expect(safeExternalUrl(undefined)).toBe('#');
    expect(safeExternalUrl(123 as unknown)).toBe('#');
    expect(safeExternalUrl('')).toBe('#');
  });
});

describe('safeEmbedUrl', () => {
  it('rejects a non-allow-listed https host', () => {
    expect(safeEmbedUrl('https://evil.tld/x')).toBeNull();
  });

  it('accepts an allow-listed YouTube embed URL', () => {
    expect(safeEmbedUrl('https://www.youtube.com/embed/x')).toBe('https://www.youtube.com/embed/x');
  });

  it('accepts a Vimeo player URL', () => {
    expect(safeEmbedUrl('https://player.vimeo.com/video/123')).toBe('https://player.vimeo.com/video/123');
  });

  it('rejects data:text/html', () => {
    expect(safeEmbedUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects http (non-https) even for an allow-listed host', () => {
    expect(safeEmbedUrl('http://www.youtube.com/embed/x')).toBeNull();
  });

  it('rejects protocol-relative and javascript: URLs', () => {
    expect(safeEmbedUrl('//www.youtube.com/embed/x')).toBeNull();
    expect(safeEmbedUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects non-string / empty input', () => {
    expect(safeEmbedUrl(null)).toBeNull();
    expect(safeEmbedUrl('')).toBeNull();
  });
});
