import SolidTimePlugin from '../main';
import { buildReport, calendarDateInTimeZone, parseReportSpec, resolveReportRange } from './report';

export async function renderReport(source: string, container: HTMLElement, plugin: SolidTimePlugin): Promise<void> {
    container.empty();
    container.addClass('solidtime-report');
    const loading = container.createDiv({ cls: 'solidtime-report-state', text: 'Loading SolidTime report…' });

    try {
        const spec = parseReportSpec(source);
        if (!plugin.api || !plugin.settings.selectedOrganizationId) {
            throw new Error('Configure the SolidTime API and select an organization in plugin settings.');
        }
        if (!plugin.currentUser) plugin.currentUser = await plugin.api.getMe();

        const timeZone = plugin.currentUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const calendarToday = calendarDateInTimeZone(new Date(), timeZone);
        const range = resolveReportRange(spec, calendarToday, plugin.currentUser.week_start || 'monday');
        const organizationId = plugin.settings.selectedOrganizationId;
        const [entries, projects, tasks] = await Promise.all([
            plugin.api.getTimeEntries(organizationId, plugin.currentUser.id, range.start, range.end, timeZone),
            plugin.api.getProjects(organizationId, true),
            plugin.api.getTasks(organizationId, null, true),
        ]);
        const report = buildReport(entries, projects, tasks, new Date());

        container.empty();
        const header = container.createDiv({ cls: 'solidtime-report-header' });
        const heading = header.createDiv();
        heading.createEl('strong', { text: spec.type === 'daily' ? 'Daily report' : 'Weekly report' });
        heading.createDiv({ cls: 'solidtime-report-range', text: range.title });
        header.createEl('strong', { cls: 'solidtime-report-total', text: formatDuration(report.totalSeconds) });

        if (report.rows.length === 0) {
            container.createDiv({ cls: 'solidtime-report-state', text: 'No time entries for this period.' });
            return;
        }

        const table = container.createEl('table', { cls: 'solidtime-report-table' });
        const headings = spec.type === 'weekly'
            ? ['Date', 'Entry', 'Project', 'Duration']
            : ['Time', 'Entry', 'Project', 'Duration'];
        const headerRow = table.createEl('thead').createEl('tr');
        headings.forEach(label => headerRow.createEl('th', { text: label }));
        const body = table.createEl('tbody');
        for (const row of report.rows) {
            const tr = body.createEl('tr');
            tr.createEl('td', {
                text: spec.type === 'weekly'
                    ? formatDate(row.start, timeZone)
                    : formatTime(row.start, timeZone),
            });
            const description = tr.createEl('td');
            description.createDiv({ text: row.description });
            if (row.task) description.createEl('small', { text: row.task });
            tr.createEl('td', { text: row.project });
            tr.createEl('td', { cls: 'solidtime-report-duration', text: formatDuration(row.durationSeconds) });
        }
    } catch (error) {
        console.error('SolidTime: Failed to render report', error);
        loading.remove();
        container.empty();
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        container.createDiv({ cls: 'solidtime-report-state solidtime-report-error', text: `Unable to load SolidTime report: ${message}` });
    }
}

function formatDuration(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function formatTime(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
}

function formatDate(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(date);
}
