import { describe, expect, it } from 'vitest';
import { buildReport, calendarDateInTimeZone, calendarRangeToUtc, parseReportSpec, resolveReportRange } from './report';
import { TimeEntryResource } from './types';

describe('parseReportSpec', () => {
    it('parses a daily report and normalizes option names and values', () => {
        expect(parseReportSpec(' Type: DAILY\n date: yesterday ')).toEqual({
            type: 'daily',
            date: 'yesterday',
        });
    });

    it('rejects unknown options instead of silently ignoring mistakes', () => {
        expect(() => parseReportSpec('type: weekly\ndata: current')).toThrow('Unknown option "data"');
    });
});

describe('resolveReportRange', () => {
    const now = new Date('2025-03-12T10:00:00Z');

    it('resolves relative and explicit daily ranges as inclusive calendar dates', () => {
        expect(resolveReportRange({ type: 'daily', date: 'yesterday' }, now, 'monday')).toEqual({
            start: '2025-03-11',
            end: '2025-03-11',
            title: 'Tuesday, March 11, 2025',
        });
        expect(resolveReportRange({ type: 'daily', date: '2024-02-29' }, now, 'monday').start).toBe('2024-02-29');
    });

    it('uses the configured start of week for current and last week', () => {
        expect(resolveReportRange({ type: 'weekly', week: 'current' }, now, 'monday')).toMatchObject({
            start: '2025-03-10', end: '2025-03-16',
        });
        expect(resolveReportRange({ type: 'weekly', week: 'last' }, now, 'sunday')).toMatchObject({
            start: '2025-03-02', end: '2025-03-08',
        });
    });
});

describe('calendarDateInTimeZone', () => {
    it('uses the SolidTime user timezone when UTC is already on the next day', () => {
        expect(calendarDateInTimeZone(new Date('2025-03-12T01:00:00Z'), 'America/New_York').toISOString())
            .toBe('2025-03-11T00:00:00.000Z');
    });
});

describe('calendarRangeToUtc', () => {
    it('uses local midnight boundaries and an exclusive end in a non-UTC timezone', () => {
        expect(calendarRangeToUtc('2025-01-15', '2025-01-15', 'Asia/Kathmandu')).toEqual({
            start: '2025-01-14T18:15:00Z',
            end: '2025-01-15T18:15:00Z',
        });
    });

    it('accounts for a DST transition within the requested calendar range', () => {
        expect(calendarRangeToUtc('2025-03-08', '2025-03-09', 'America/New_York')).toEqual({
            start: '2025-03-08T05:00:00Z',
            end: '2025-03-10T04:00:00Z',
        });
    });
});

describe('buildReport', () => {
    const entry = (overrides: Partial<TimeEntryResource>): TimeEntryResource => ({
        id: 'entry', start: '2025-03-10T09:00:00Z', end: '2025-03-10T10:30:00Z',
        duration: 5400, description: 'Implementation', task_id: null, project_id: 'project',
        organization_id: 'org', user_id: 'user', tags: [], billable: false, ...overrides,
    });

    it('sorts entries, resolves names, and totals durations', () => {
        const report = buildReport([
            entry({ id: 'later', start: '2025-03-11T12:00:00Z', end: '2025-03-11T12:30:00Z', duration: 1800 }),
            entry({ id: 'earlier' }),
        ], [{ id: 'project', name: 'Website' }], [], new Date('2025-03-12T10:00:00Z'));

        expect(report.totalSeconds).toBe(7200);
        expect(report.rows.map(row => row.id)).toEqual(['earlier', 'later']);
        expect(report.rows[0]).toMatchObject({ project: 'Website', description: 'Implementation', durationSeconds: 5400 });
    });

    it('calculates elapsed time for a running entry even when the API duration is zero', () => {
        const report = buildReport([
            entry({ start: '2025-03-12T09:00:00Z', end: null, duration: 0 }),
        ], [], [], new Date('2025-03-12T10:30:00Z'));

        expect(report.rows[0].durationSeconds).toBe(5400);
        expect(report.totalSeconds).toBe(5400);
    });
});
