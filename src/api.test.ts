import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Notice, requestUrl } from 'obsidian';
import { SolidTimeApi } from './api';
import { TimeEntryResource } from './types';

const response = (json: unknown) => ({
    status: 200, json, text: JSON.stringify(json), arrayBuffer: new ArrayBuffer(1),
});

describe('SolidTimeApi.getTimeEntries', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('resolves member_id, paginates by offset, and retains exactly the local calendar range', async () => {
        const requested = entry('inside', '2025-03-09T05:30:00Z');
        const adjacent = entry('outside', '2025-03-10T04:30:00Z');
        const firstPage = [requested, ...entries(499, 'page-one')];
        vi.mocked(requestUrl)
            .mockResolvedValueOnce(response({ data: [{ id: 'member', user_id: 'user' }], links: { next: null } }) as never)
            .mockResolvedValueOnce(response({ data: firstPage, meta: { total: 501 } }) as never)
            .mockResolvedValueOnce(response({ data: [adjacent], meta: { total: 501 } }) as never);

        const result = await new SolidTimeApi('key', 'https://solid.example').getTimeEntries(
            'org', 'user', '2025-03-09', '2025-03-09', 'America/New_York'
        );

        expect(result.map(value => value.id)).toEqual(['inside']);
        const urls = vi.mocked(requestUrl).mock.calls.slice(1).map(([options]) =>
            new URL(typeof options === 'string' ? options : options.url));
        expect(urls[0].pathname).toBe('/v1/organizations/org/time-entries');
        expect(urls[0].searchParams.get('member_id')).toBe('member');
        expect(urls[0].searchParams.get('user_id')).toBe('user');
        expect(urls[0].searchParams.get('start')).toBe('2025-03-09T05:00:00Z');
        expect(urls[0].searchParams.get('end')).toBe('2025-03-10T04:00:00Z');
        expect(urls.map(url => url.searchParams.get('offset'))).toEqual(['0', '500']);
        expect(Notice).not.toHaveBeenCalled();
    });

    it('rejects a repeated final page that does not reach the declared total', async () => {
        const firstPage = entries(500, 'repeated');
        mockTimeEntryPages(
            { data: firstPage, meta: { total: 501 } },
            { data: firstPage, meta: { total: 501 } },
        );

        await expect(getTimeEntries()).rejects.toThrow(/complete report cannot be guaranteed/i);
    });

    it('rejects a partially overlapping final page that leaves too few unique entries', async () => {
        const firstPage = entries(500, 'overlap');
        mockTimeEntryPages(
            { data: firstPage, meta: { total: 501 } },
            { data: [firstPage[499]], meta: { total: 501 } },
        );

        await expect(getTimeEntries()).rejects.toThrow(/complete report cannot be guaranteed/i);
    });

    it('rejects missing total metadata even on a short page', async () => {
        mockTimeEntryPages({ data: [entry('only', '2025-01-01T12:00:00Z')], meta: {} });

        await expect(getTimeEntries()).rejects.toThrow(/pagination metadata/i);
    });

    it('rejects inconsistent totals across pages', async () => {
        mockTimeEntryPages(
            { data: entries(500, 'changing'), meta: { total: 501 } },
            { data: [entry('last', '2025-01-01T12:00:00Z')], meta: { total: 502 } },
        );

        await expect(getTimeEntries()).rejects.toThrow(/pagination total changed/i);
    });

    it('accepts a unique final page that exactly reaches the declared total', async () => {
        mockTimeEntryPages(
            { data: entries(500, 'valid'), meta: { total: 501 } },
            { data: [entry('final', '2025-01-01T12:00:00Z')], meta: { total: 501 } },
        );

        const result = await getTimeEntries();

        expect(result).toHaveLength(501);
        expect(result.at(-1)?.id).toBe('final');
    });

    it('silently falls back to the documented singular route on 404', async () => {
        vi.mocked(requestUrl)
            .mockResolvedValueOnce(response({ data: [{ id: 'member', user_id: 'user' }], links: { next: null } }) as never)
            .mockResolvedValueOnce({ status: 404, json: {}, text: '', arrayBuffer: new ArrayBuffer(0) } as never)
            .mockResolvedValueOnce(response({ data: [], meta: { total: 0 } }) as never);

        await new SolidTimeApi('key', 'https://solid.example').getTimeEntries(
            'org', 'user', '2025-01-01', '2025-01-01', 'UTC'
        );

        const lastOptions = vi.mocked(requestUrl).mock.calls[2][0];
        const lastUrl = new URL(typeof lastOptions === 'string' ? lastOptions : lastOptions.url);
        expect(lastUrl.pathname).toBe('/v1/organization/org/time-entries');
        expect(Notice).not.toHaveBeenCalled();
    });
});

describe('SolidTimeApi project and task filters', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('requests only active projects and incomplete tasks by default', async () => {
        vi.mocked(requestUrl).mockResolvedValue(response({ data: [], links: { next: null } }) as never);
        const api = new SolidTimeApi('key', 'https://solid.example');

        await api.getProjects('org');
        await api.getTasks('org', 'project/id');

        const urls = vi.mocked(requestUrl).mock.calls.map(([options]) =>
            new URL(typeof options === 'string' ? options : options.url));
        expect(urls[0].searchParams.get('archived')).toBe('false');
        expect(urls[1].searchParams.get('done')).toBe('false');
        expect(urls[1].searchParams.get('project_id')).toBe('project/id');
    });

    it('uses the API all value when archived projects and done tasks are included', async () => {
        vi.mocked(requestUrl).mockResolvedValue(response({ data: [], links: { next: null } }) as never);
        const api = new SolidTimeApi('key', 'https://solid.example');

        await api.getProjects('org', true);
        await api.getTasks('org', null, true);

        const urls = vi.mocked(requestUrl).mock.calls.map(([options]) =>
            new URL(typeof options === 'string' ? options : options.url));
        expect(urls[0].searchParams.get('archived')).toBe('all');
        expect(urls[1].searchParams.get('done')).toBe('all');
    });
});

function entry(id: string, start: string): TimeEntryResource {
    return {
        id, start, end: start, duration: 0, description: null, task_id: null, project_id: null,
        organization_id: 'org', user_id: 'user', tags: [], billable: false,
    };
}

function entries(count: number, prefix: string): TimeEntryResource[] {
    return Array.from({ length: count }, (_, index) =>
        entry(`${prefix}-${index}`, '2025-01-01T12:00:00Z'));
}

function mockTimeEntryPages(...pages: unknown[]): void {
    vi.mocked(requestUrl)
        .mockResolvedValueOnce(response({ data: [{ id: 'member', user_id: 'user' }], links: { next: null } }) as never);
    pages.forEach(page => vi.mocked(requestUrl).mockResolvedValueOnce(response(page) as never));
}

function getTimeEntries(): Promise<TimeEntryResource[]> {
    return new SolidTimeApi('key', 'https://solid.example').getTimeEntries(
        'org', 'user', '2025-01-01', '2025-01-01', 'UTC'
    );
}
