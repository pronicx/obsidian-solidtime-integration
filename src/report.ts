import { ProjectResource, TaskResource, TimeEntryResource, Weekday } from './types';

export type ReportSpec =
    | { type: 'daily'; date: string }
    | { type: 'weekly'; week: string };

export interface ReportRange {
    start: string;
    end: string;
    title: string;
}

export interface ReportRow {
    id: string;
    start: Date;
    description: string;
    project: string;
    task: string | null;
    durationSeconds: number;
}

export interface ReportData {
    rows: ReportRow[];
    totalSeconds: number;
}

const WEEKDAYS: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportSpec(source: string): ReportSpec {
    const options: Record<string, string> = {};
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf(':');
        if (separator < 1) throw new Error(`Invalid option line "${line}". Use "key: value".`);
        const key = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim().toLowerCase();
        if (!value) throw new Error(`Option "${key}" needs a value.`);
        if (options[key]) throw new Error(`Option "${key}" is specified more than once.`);
        options[key] = value;
    }

    for (const key of Object.keys(options)) {
        if (!['type', 'date', 'week'].includes(key)) throw new Error(`Unknown option "${key}".`);
    }
    if (options.type === 'daily') {
        if (options.week) throw new Error('A daily report uses "date", not "week".');
        return { type: 'daily', date: options.date || 'today' };
    }
    if (options.type === 'weekly') {
        if (options.date) throw new Error('A weekly report uses "week", not "date".');
        return { type: 'weekly', week: options.week || 'current' };
    }
    throw new Error('Option "type" must be "daily" or "weekly".');
}

export function resolveReportRange(spec: ReportSpec, now: Date, weekStart: Weekday): ReportRange {
    const today = startOfUtcDay(now);
    if (spec.type === 'daily') {
        const date = resolveDateValue(spec.date, today, { today: 0, yesterday: -1 });
        const value = formatDate(date);
        return { start: value, end: value, title: formatLongDate(date) };
    }

    let anchor = resolveDateValue(spec.week, today, { current: 0, last: -7 });
    const startDay = WEEKDAYS.indexOf(weekStart);
    if (startDay < 0) throw new Error(`Unsupported week start "${weekStart}".`);
    anchor = addDays(anchor, -((anchor.getUTCDay() - startDay + 7) % 7));
    const end = addDays(anchor, 6);
    return {
        start: formatDate(anchor),
        end: formatDate(end),
        title: `${formatShortDate(anchor)} – ${formatShortDate(end)}`,
    };
}

export function buildReport(
    entries: TimeEntryResource[],
    projects: Pick<ProjectResource, 'id' | 'name'>[],
    tasks: Pick<TaskResource, 'id' | 'name'>[],
    now: Date
): ReportData {
    const projectNames = new Map(projects.map(project => [project.id, project.name]));
    const taskNames = new Map(tasks.map(task => [task.id, task.name]));
    const rows = entries.map(entry => {
        const start = new Date(entry.start);
        const end = entry.end ? new Date(entry.end) : now;
        const calculatedDuration = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
        return {
            id: entry.id,
            start,
            description: entry.description || 'No description',
            project: entry.project_id ? projectNames.get(entry.project_id) || 'Unknown project' : 'No project',
            task: entry.task_id ? taskNames.get(entry.task_id) || 'Unknown task' : null,
            durationSeconds: entry.end !== null && typeof entry.duration === 'number'
                ? entry.duration
                : calculatedDuration,
        };
    }).filter(row => !isNaN(row.start.getTime()))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    return { rows, totalSeconds: rows.reduce((total, row) => total + row.durationSeconds, 0) };
}

export function calendarDateInTimeZone(now: Date, timeZone: string): Date {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(now);
        const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
        return parseDate(`${value('year')}-${value('month')}-${value('day')}`);
    } catch (_) {
        return startOfUtcDay(now);
    }
}

export function calendarRangeToUtc(start: string, end: string, timeZone: string): { start: string; end: string } {
    const startDate = parseDate(start);
    const exclusiveEndDate = addDays(parseDate(end), 1);
    return {
        start: localMidnightToUtc(startDate, timeZone),
        end: localMidnightToUtc(exclusiveEndDate, timeZone),
    };
}

function localMidnightToUtc(calendarDate: Date, timeZone: string): string {
    const target = calendarDate.getTime();
    let instant = target;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    // Re-evaluate the offset because it can differ on the two sides of a DST boundary.
    for (let attempt = 0; attempt < 3; attempt++) {
        const parts = formatter.formatToParts(new Date(instant));
        const part = (type: Intl.DateTimeFormatPartTypes): number =>
            Number(parts.find(value => value.type === type)?.value);
        const hour = part('hour') === 24 ? 0 : part('hour');
        const representedAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), hour, part('minute'), part('second'));
        const correction = target - representedAsUtc;
        instant += correction;
        if (correction === 0) break;
    }
    return new Date(instant).toISOString().replace('.000Z', 'Z');
}

function resolveDateValue(value: string, today: Date, relative: Record<string, number>): Date {
    if (Object.prototype.hasOwnProperty.call(relative, value)) return addDays(today, relative[value]);
    if (!DATE_PATTERN.test(value)) {
        throw new Error(`Invalid date "${value}". Use ${Object.keys(relative).join(', ')}, or YYYY-MM-DD.`);
    }
    return parseDate(value);
}

function parseDate(value: string): Date {
    const date = new Date(`${value}T00:00:00Z`);
    if (isNaN(date.getTime()) || formatDate(date) !== value) throw new Error(`Invalid calendar date "${value}".`);
    return date;
}

function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, amount: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
}

function formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function formatLongDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatShortDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
