export interface TimeEntryQueryOptions {
    userId: string;
    memberId: string;
    startDate: string;
    endDate: string;
    startUtc: string;
    endUtc: string;
    offset: number;
}

const PAGE_LIMIT = 500;

export function buildTimeEntryQuery(options: TimeEntryQueryOptions): string {
    const parameters: [string, string][] = [
        ['user_id', options.userId],
        ['member_id', options.memberId],
        ['after', shiftCalendarDate(options.startDate, -1)],
        ['before', shiftCalendarDate(options.endDate, 1)],
        ['start', options.startUtc],
        ['end', options.endUtc],
        ['only_full_dates', 'true'],
        ['limit', String(PAGE_LIMIT)],
        ['offset', String(options.offset)],
    ];
    return parameters.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

export function timeEntryPageLimit(): number {
    return PAGE_LIMIT;
}

function shiftCalendarDate(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
