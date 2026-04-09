/**
 * @file data-sanitizer.service.spec.ts
 *
 * Unit tests for DataSanitizer — PII stripping before LLM calls.
 * Tests all 5 pattern types (email, phone, CC, SSN, IP),
 * enabled/disabled config flag, and batch sanitize.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSanitizer } from './data-sanitizer.service';
import { APP_CONFIG } from '@libs/config';

function makeConfig(pii = true) {
  return { aiEnablePiiSanitization: pii };
}

describe('DataSanitizer', () => {
  let sanitizer: DataSanitizer;

  describe('when PII sanitization is enabled (default)', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DataSanitizer,
          { provide: APP_CONFIG, useValue: makeConfig(true) },
        ],
      }).compile();

      sanitizer = module.get(DataSanitizer);
    });

    // ── Email ─────────────────────────────────────────────────────────

    it('replaces a plain email address', () => {
      expect(
        sanitizer.sanitize('Contact me at user@example.com for help'),
      ).toBe('Contact me at [EMAIL] for help');
    });

    it('replaces email with plus-addressing', () => {
      const result = sanitizer.sanitize(
        'Send to user+tag@sub.domain.io please',
      );
      expect(result).toBe('Send to [EMAIL] please');
    });

    it('replaces multiple emails in one string', () => {
      const result = sanitizer.sanitize('a@b.com and c@d.org');
      expect(result).toBe('[EMAIL] and [EMAIL]');
    });

    // ── Phone ─────────────────────────────────────────────────────────

    it('replaces a US phone number', () => {
      const result = sanitizer.sanitize('Call me at +1 555 123 4567');
      expect(result).toContain('[PHONE]');
    });

    it('replaces a phone with dashes', () => {
      const result = sanitizer.sanitize('My number is 555-123-4567');
      expect(result).toContain('[PHONE]');
    });

    // ── Credit card ───────────────────────────────────────────────────

    it('replaces a 16-digit credit card number (spaced)', () => {
      const result = sanitizer.sanitize('Card: 4111 1111 1111 1111');
      expect(result).toContain('[CREDIT_CARD]');
    });

    it('replaces a 16-digit credit card number (dashes)', () => {
      const result = sanitizer.sanitize('Visa: 4111-1111-1111-1111');
      expect(result).toContain('[CREDIT_CARD]');
    });

    // ── SSN ───────────────────────────────────────────────────────────

    it('replaces a SSN with dashes', () => {
      const result = sanitizer.sanitize('My SSN is 123-45-6789');
      expect(result).toContain('[SSN]');
    });

    it('replaces a SSN with spaces', () => {
      const result = sanitizer.sanitize('SSN: 111 22 3333');
      expect(result).toContain('[SSN]');
    });

    // ── IP address ────────────────────────────────────────────────────

    it('replaces an IPv4 address', () => {
      const result = sanitizer.sanitize('Server IP is 192.168.1.100');
      expect(result).toContain('[IP_ADDRESS]');
    });

    it('replaces multiple IPs', () => {
      const result = sanitizer.sanitize('From 10.0.0.1 to 172.16.0.5');
      expect(result.match(/\[IP_ADDRESS\]/g)?.length).toBe(2);
    });

    // ── Mixed content ─────────────────────────────────────────────────

    it('sanitizes multiple PII types in one message', () => {
      const raw =
        'Email: admin@acme.com, IP: 10.0.0.1, Card: 4111-1111-1111-1111';
      const result = sanitizer.sanitize(raw);
      expect(result).toContain('[EMAIL]');
      expect(result).toContain('[IP_ADDRESS]');
      expect(result).toContain('[CREDIT_CARD]');
      expect(result).not.toContain('admin@acme.com');
      expect(result).not.toContain('10.0.0.1');
    });

    // ── Edge cases ────────────────────────────────────────────────────

    it('returns empty string unchanged', () => {
      expect(sanitizer.sanitize('')).toBe('');
    });

    it('returns plain text without PII unchanged', () => {
      const text = 'Hello, how are you today?';
      expect(sanitizer.sanitize(text)).toBe(text);
    });

    // ── Batch ─────────────────────────────────────────────────────────

    it('sanitizeAll processes each text in an array', () => {
      const results = sanitizer.sanitizeAll([
        'Email: foo@bar.com',
        'No PII here',
        'IP: 1.2.3.4',
      ]);
      expect(results[0]).toContain('[EMAIL]');
      expect(results[1]).toBe('No PII here');
      expect(results[2]).toContain('[IP_ADDRESS]');
    });

    it('sanitizeAll returns empty array when given empty array', () => {
      expect(sanitizer.sanitizeAll([])).toEqual([]);
    });
  });

  // ── Disabled mode ─────────────────────────────────────────────────

  describe('when PII sanitization is disabled', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DataSanitizer,
          { provide: APP_CONFIG, useValue: makeConfig(false) },
        ],
      }).compile();

      sanitizer = module.get(DataSanitizer);
    });

    it('returns text with email unchanged', () => {
      const text = 'Contact user@example.com';
      expect(sanitizer.sanitize(text)).toBe(text);
    });

    it('returns text with IP unchanged', () => {
      const text = 'Server: 192.168.0.1';
      expect(sanitizer.sanitize(text)).toBe(text);
    });

    it('sanitizeAll returns texts unchanged', () => {
      const texts = ['foo@bar.com', '192.168.0.1'];
      expect(sanitizer.sanitizeAll(texts)).toEqual(texts);
    });
  });
});
