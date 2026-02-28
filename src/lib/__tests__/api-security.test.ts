import { describe, expect, test } from 'bun:test';
import { NextResponse } from 'next/server';
import { applyPrivateNoStoreHeaders } from '@/lib/api-security';

describe('api security headers', () => {
    test('applies private no-store headers', () => {
        const response = applyPrivateNoStoreHeaders(
            NextResponse.json({ ok: true })
        );

        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
        expect(response.headers.get('Pragma')).toBe('no-cache');
        expect(response.headers.get('Vary')).toBe('Cookie');
    });
});
