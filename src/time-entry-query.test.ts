import { describe, expect, it } from 'vitest';
import { buildTimeEntryQuery } from './time-entry-query';

describe('buildTimeEntryQuery', () => {
    it('sends old and current filters through one compatibility query', () => {
        const query = new URLSearchParams(buildTimeEntryQuery({
            userId: 'user id', memberId: 'member id', startDate: '2025-03-08', endDate: '2025-03-09',
            startUtc: '2025-03-08T05:00:00Z', endUtc: '2025-03-10T04:00:00Z', offset: 500,
        }));

        expect(Object.fromEntries(query.entries())).toEqual({
            user_id: 'user id', member_id: 'member id',
            after: '2025-03-07', before: '2025-03-10',
            start: '2025-03-08T05:00:00Z', end: '2025-03-10T04:00:00Z',
            only_full_dates: 'true', limit: '500', offset: '500',
        });
    });
});
