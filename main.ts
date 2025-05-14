import { Plugin, WorkspaceLeaf, Notice, ItemView, moment } from 'obsidian'; // Note: Removed moment from here
import { SolidTimeSettingTab, SolidTimeSettings, DEFAULT_SETTINGS } from './src/settings';
import { SolidTimeApi } from './src/api';
import {
    TimeEntryResource,
    ProjectResource,
    TaskResource,
    TagResource,
    TagStoreRequest,
    TimeEntryStartPayload,
    TimeEntryStopPayload,
    PersonalMembershipResource,
    MemberResource,
    UserResource
} from './src/types';
import { StartTimerModal } from './src/modals';
import { SolidTimeView, SOLIDTIME_VIEW_TYPE } from './src/view';


export default class SolidTimePlugin extends Plugin {
    settings: SolidTimeSettings;
    api: SolidTimeApi | null = null;
    statusBarItemEl: HTMLElement | null = null;
    activeTimeEntry: TimeEntryResource | null = null;
    statusIntervalId: number | null = null;
    fetchIntervalId: number | null = null;

    // Data caches
    projects: ProjectResource[] = [];
    tasks: TaskResource[] = [];
    tags: TagResource[] = [];
    currentUser: UserResource | null = null;


    async onload() {
        await this.loadSettings();

        // --- View Registration ---
        this.registerView(
            SOLIDTIME_VIEW_TYPE,
            (leaf) => new SolidTimeView(leaf, this)
        );
        // --- End View Registration ---

        this.statusBarItemEl = this.addStatusBarItem();
        this.statusBarItemEl.setText('SolidTime: Init...');
        this.statusBarItemEl.addClass('solidtime-statusbar');

        this.addSettingTab(new SolidTimeSettingTab(this.app, this));

        this.setupApi();

        if (this.api) {
            try {
                // console.log("SolidTime: Fetching current user on load...");
                this.currentUser = await this.api.getMe();
                // console.log("SolidTime: Current user fetched:", this.currentUser?.name);
            } catch (e) {
                console.error("SolidTime: Failed to fetch current user on load", e);
                if (this.settings.apiKey && this.settings.apiBaseUrl) {
                    new Notice("SolidTime: Could not verify user. Check API key/URL.");
                }
            }
        }

        if (this.checkSettingsAndApi(false)) {
            await this.loadSolidTimeData();
            await this.updateStatus();
            this.setupIntervals();
        } else {
            this.statusBarItemEl.setText('SolidTime: Check Settings');
            // Show notice based on which part is missing
            if (!this.settings.apiKey || !this.settings.apiBaseUrl) {
                // Notice handled by checkSettingsAndApi if called with showNotice=true
            } else if (!this.settings.selectedOrganizationId) {
                // Notice handled by checkSettingsAndApi if called with showNotice=true
            } else if (!this.currentUser && this.settings.apiKey && this.settings.apiBaseUrl) {
                new Notice("SolidTime Plugin: Could not fetch user data. Check connection or API key.");
            }
        }


        // === Commands === (Commands remain the same)
        this.addCommand({
            id: 'start-timer',
            name: 'Start timer (prompt)',
            callback: () => {
                if (!this.checkSettingsAndApi()) return;
                // Check if data seems reasonable before opening modal
                // This is a heuristic, might need refinement if empty lists are valid
                // if (this.projects.length === 0 && this.tags.length === 0 && this.tasks.length === 0) {
                //    console.log("SolidTime: Data might not be loaded yet for modal.");
                //    new Notice("Fetching SolidTime data... Please try again shortly.");
                //    this.loadSolidTimeData(); // Trigger load again
                //    return;
                // }
                new StartTimerModal(this.app, this).open();
            },
        });

        this.addCommand({
            id: 'stop-timer',
            name: 'Stop current timer',
            callback: () => {
                this.stopCurrentTimer();
            },
        });

        this.addCommand({
            id: 'show-current-timer',
            name: 'Show current timer details',
            callback: () => {
                if (!this.api) {
                    new Notice("SolidTime: API not configured.");
                    return;
                }
                this.showCurrentTimerDetails();
            },
        });

        this.addCommand({
            id: 'refresh-data',
            name: 'Refresh projects/tasks/tags',
            callback: async () => {
                if (!this.api || !this.settings.selectedOrganizationId) {
                    new Notice("SolidTime: Configure API and select Organization first.");
                    return;
                }
                await this.loadSolidTimeData();
                new Notice("SolidTime data refreshed.");
            },
        });

        this.addCommand({
            id: 'refresh-user',
            name: 'Refresh user info',
            callback: async () => {
                if (!this.api) { new Notice("SolidTime: API not configured."); return; }
                try {
                    // console.log("SolidTime: Manually refreshing user info...");
                    this.currentUser = await this.api.getMe();
                    new Notice(`SolidTime: User info refreshed (${this.currentUser?.name}).`);
                } catch (e) {
                    console.error("SolidTime: Failed to refresh user info", e);
                    new Notice("SolidTime: Failed to refresh user info.");
                }
            },
        });

        this.addCommand({
            id: 'show-view',
            name: 'Show tracker view',
            callback: () => {
                this.activateView();
            },
        });

        this.addRibbonIcon('clock', 'Open SolidTime tracker', () => {
            this.activateView();
        });


        console.log('SolidTime Plugin Loaded');
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(SOLIDTIME_VIEW_TYPE);

        if (leaves.length > 0) { leaf = leaves[0]; }
        else {
            leaf = workspace.getRightLeaf(false);
            if (!leaf) { console.error("SolidTime: Could not get right leaf for the view."); return; }
            await leaf.setViewState({ type: SOLIDTIME_VIEW_TYPE, active: true });
        }
        if (leaf) { workspace.revealLeaf(leaf); }
    }

    updateSolidTimeView() {
        // Get all leaves of our view type
        const leaves: WorkspaceLeaf[] = this.app.workspace.getLeavesOfType(SOLIDTIME_VIEW_TYPE);

        // Iterate over the retrieved leaves
        for (const leaf of leaves) {
            // Check if the view attached to the leaf is actually our SolidTimeView
            if (leaf.view instanceof SolidTimeView) {
                // console.log("Updating a SolidTimeView instance in leaf:", leaf.id); // Optional debug log
                // Call the update method on the specific view instance
                leaf.view.updateView();
            }
        }
    }

    onunload() {
        this.clearTimers();
        if (this.statusBarItemEl) {
            this.statusBarItemEl.remove();
        }
        // --- Detach Leaves Guideline Applied: REMOVED detachLeavesOfType ---
        // this.app.workspace.detachLeavesOfType(SOLIDTIME_VIEW_TYPE);
        // --- End Detach Leaves Guideline ---
        console.log('SolidTime Plugin Unloaded'); // Keep essential lifecycle log
    }

    async loadSettings() { // loadSettings remains the same
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        const previousApi = this.api;
        this.setupApi();

        // Refetch user if API setup changed or was successful now
        if (this.api && (!previousApi || !this.currentUser)) { // Refetch if API setup changed OR user was missing
            try {
                // console.log("SolidTime: API configured/changed, fetching user..."); // Removed verbose log
                this.currentUser = await this.api.getMe();
                // console.log("SolidTime: User fetched after settings save:", this.currentUser?.name); // Removed verbose log
            } catch (e) {
                console.error("SolidTime: Failed to fetch current user after settings save", e);
                this.currentUser = null;
                new Notice("SolidTime: Could not verify user with new settings.");
            }
        } else if (!this.api) {
            this.currentUser = null;
        }

        // Proceed with data load and intervals only if fully configured
        if (this.api && this.settings.selectedOrganizationId) {
            await this.loadSolidTimeData();
            await this.updateStatus(); // updateStatus calls updateSolidTimeView
            this.setupIntervals();
        } else {
            this.clearTimers();
            this.activeTimeEntry = null;
            if (this.statusBarItemEl) {
                this.statusBarItemEl.setText('SolidTime: Check settings');
                this.statusBarItemEl.removeClass('solidtime-active');
                this.statusBarItemEl.removeAttribute('title');
            }
            // Clear data and update view if config becomes invalid
            this.projects = []; this.tasks = []; this.tags = [];
            this.updateSolidTimeView(); // Update view to reflect cleared state/setup needed
        }
    }

    setupApi() {
        if (this.settings.apiKey && this.settings.apiBaseUrl) {
            if (!this.api || this.api['apiKey'] !== this.settings.apiKey || this.api['baseUrl'] !== this.settings.apiBaseUrl) {
                // console.log("SolidTime: Initializing/Updating API client..."); // Removed verbose log
                this.api = new SolidTimeApi(this.settings.apiKey, this.settings.apiBaseUrl);
            }
        } else {
            // if(this.api) console.log("SolidTime: De-initializing API client due to missing settings."); // Removed verbose log
            this.api = null;
        }
    }

    checkSettingsAndApi(showNotice = true): boolean {
        let valid = true;
        let message = "";

        if (!this.settings.apiKey || !this.settings.apiBaseUrl) {
            message = "SolidTime API Key or Base URL not set."; valid = false;
        } else if (!this.settings.selectedOrganizationId) {
            message = "SolidTime organization not selected."; valid = false;
        } else if (!this.api) {
            message = "SolidTime API client not initialized.";
            this.setupApi(); // Try again
            if (!this.api) valid = false;
        }

        if (!valid && showNotice) { new Notice(message + " Please configure in plugin settings."); }
        return valid;
    }

    clearTimers() {
        if (this.statusIntervalId) { window.clearInterval(this.statusIntervalId); this.statusIntervalId = null; }
        if (this.fetchIntervalId) { window.clearInterval(this.fetchIntervalId); this.fetchIntervalId = null; }
    }

    setupIntervals() {
        this.clearTimers();
        if (this.settings.statusBarUpdateIntervalSeconds > 0 && this.api) {
            this.statusIntervalId = window.setInterval(() => this.updateStatus(), this.settings.statusBarUpdateIntervalSeconds * 1000);
            // console.log(`SolidTime: Status interval set to ${this.settings.statusBarUpdateIntervalSeconds}s`);
        }
        if (this.settings.autoFetchIntervalMinutes > 0 && this.api && this.settings.selectedOrganizationId) {
            this.fetchIntervalId = window.setInterval(() => this.loadSolidTimeData(), this.settings.autoFetchIntervalMinutes * 60 * 1000);
            // console.log(`SolidTime: Fetch interval set to ${this.settings.autoFetchIntervalMinutes}min`);
        }
    }

    async loadSolidTimeData() {
        if (!this.api || !this.settings.selectedOrganizationId) {
            // console.log("SolidTime: Cannot fetch data, API or Organization not configured.");
            this.projects = []; this.tasks = []; this.tags = [];
            return;
        }
        // console.log("SolidTime: Fetching data for org:", this.settings.selectedOrganizationId);
        try {
            const [projects, tasks, tags] = await Promise.all([
                this.api.getProjects(this.settings.selectedOrganizationId),
                this.api.getTasks(this.settings.selectedOrganizationId),
                this.api.getTags(this.settings.selectedOrganizationId)
            ]);
            this.projects = projects || []; this.tasks = tasks || []; this.tags = tags || [];
            // console.log(`SolidTime: Fetched ${this.projects.length} projects, ${this.tasks.length} tasks, ${this.tags.length} tags.`);
        } catch (error) {
            console.error("SolidTime: Failed to fetch data", error);
            this.projects = []; this.tasks = []; this.tags = [];
        }
    }

    async updateActiveTimerDetails(updates: {
        description?: string | null;
        projectId?: string | null;
        taskId?: string | null; // Keep taskId if you might support updating it later
        tagIds?: string[];
        billable?: boolean;
    }) {
        // console.log("Attempting to update timer with:", updates); // Debug log

        if (!this.api) { new Notice("SolidTime: API not configured."); return; }
        if (!this.currentUser) {
            try { this.currentUser = await this.api.getMe(); }
            catch (e) { new Notice("Error: Could not verify current user."); return; }
        }
        if (!this.activeTimeEntry) { new Notice("SolidTime: No timer is running to update."); return; }
        if (!this.activeTimeEntry.organization_id || !this.activeTimeEntry.start) {
            new Notice("Error: Active entry data incomplete."); return;
        }

        const entryToUpdate = this.activeTimeEntry;
        const orgIdForEntry = entryToUpdate.organization_id;
        let correctMemberId: string | null = null;

        // Fetch correct member ID (necessary for the PUT request)
        try {
            const members = await this.api!.getMembers(orgIdForEntry);
            const currentMembership = members.find(member => member.user_id === this.currentUser!.id);
            if (currentMembership) { correctMemberId = currentMembership.id; }
            else { new Notice(`Error: User not found in org ${orgIdForEntry}.`); return; }
        } catch (error) { new Notice("Error fetching members."); return; }
        if (!correctMemberId) { new Notice("Error determining Member ID."); return; }

        // Construct payload by merging existing entry with updates
        // IMPORTANT: DO NOT include 'end' field unless stopping. DO NOT include 'start'.
        const payloadToSend = {
            member_id: correctMemberId,
            // start: entryToUpdate.start, // NO START
            // end: null,                 // NO END
            billable: 'billable' in updates ? updates.billable : entryToUpdate.billable,
            project_id: 'projectId' in updates ? updates.projectId : entryToUpdate.project_id,
            task_id: 'taskId' in updates ? updates.taskId : entryToUpdate.task_id, // Keep task if available
            description: 'description' in updates ? updates.description : entryToUpdate.description,
            tags: 'tagIds' in updates ? updates.tagIds : entryToUpdate.tags,
        };

        // console.log("Update Payload:", JSON.stringify(payloadToSend, null, 2));

        try {
            new Notice("SolidTime: Updating timer...");
            // Use the same PUT endpoint (stopTimeEntry internally calls PUT)
            const updatedEntry = await this.api!.stopTimeEntry(orgIdForEntry, entryToUpdate.id, payloadToSend as TimeEntryStopPayload); // Cast is okay

            // IMPORTANT: Update local state with the response from the server
            this.activeTimeEntry = updatedEntry;

            // Refresh UI
            this.renderStatusBar();
            this.updateSolidTimeView();
            new Notice("SolidTime: Timer updated!");

        } catch (error) {
            console.error("SolidTime: Failed to update timer", error);
            new Notice("SolidTime: Failed to update timer. Check console.");
            // Consider refreshing status fully on failure
            await this.updateStatus();
        }
    }

    async createTag(tagName: string): Promise<TagResource | null> {
        if (!this.checkSettingsAndApi()) return null;
        if (!this.settings.selectedOrganizationId) {
            new Notice("No organization selected in settings.");
            return null;
        }
        try {
            const newTag = await this.api!.createTag(this.settings.selectedOrganizationId, tagName);
            // Add to local cache immediately for faster UI update in modal
            this.tags.push(newTag);
            this.tags.sort((a, b) => a.name.localeCompare(b.name)); // Keep sorted
            return newTag;
        } catch (error) {
            console.error("Plugin: Failed to create tag via API", error);
            // Notice might be shown by API layer
            return null;
        }
    }

    async updateStatus() { // updateStatus logic remains the same, relies on renderStatusBar
        if (!this.api) {
            if (this.statusBarItemEl && this.statusBarItemEl.getText().startsWith('⏱️')) {
                this.statusBarItemEl.setText('SolidTime: Check Settings');
                this.statusBarItemEl.removeClass('solidtime-active');
                this.statusBarItemEl.removeAttribute('title');
            }
            this.activeTimeEntry = null;
            return;
        }
        try {
            this.activeTimeEntry = await this.api.getActiveTimeEntry();
            this.renderStatusBar();
            this.updateSolidTimeView();
        } catch (error) {
            console.error("SolidTime: Failed to update status", error);
            if (this.statusBarItemEl) {
                if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
                    this.statusBarItemEl.setText('SolidTime: Auth Error');
                    new Notice("SolidTime: Authentication error fetching status. Check API Key.");
                } else { this.statusBarItemEl.setText('SolidTime: Error'); }
                this.statusBarItemEl.removeClass('solidtime-active'); this.statusBarItemEl.removeAttribute('title');
            }
            this.activeTimeEntry = null;
            this.updateSolidTimeView();
        }
    }

    renderStatusBar() {
        if (!this.statusBarItemEl) return;

        if (this.activeTimeEntry && this.activeTimeEntry.start) { // Check if start time exists
            const startDateTime = moment.utc(this.activeTimeEntry.start);
            if (!startDateTime.isValid) {
                console.error("SolidTime: Failed to parse start time for status bar:", this.activeTimeEntry.start);
                this.statusBarItemEl.setText('SolidTime: Invalid date');
                this.statusBarItemEl.removeClass('solidtime-active'); // Ensure inactive class state
                this.statusBarItemEl.removeAttribute('title');
                return;
             }
            const nowDateTime = moment.utc();
            const duration = nowDateTime.diff(startDateTime);
            const formattedDuration = this.formatDuration(duration);

            let display = `🟢 ${formattedDuration}`;
            
            const project = this.projects.find(p => p.id === this.activeTimeEntry?.project_id);
            if (project) { display += ` | ${project.name}`; }
            else if (this.activeTimeEntry.project_id) { display += ` | (Project?)`; }
            if (this.activeTimeEntry.description) {
                const desc = this.activeTimeEntry.description.length > 20 ? this.activeTimeEntry.description.substring(0, 18) + '...' : this.activeTimeEntry.description;
                display += ` - ${desc}`;
            }

            this.statusBarItemEl.setText(display);
            this.statusBarItemEl.addClass('solidtime-active');
            
            const tooltipProjectName = project?.name || `(ID: ...${this.activeTimeEntry.project_id?.slice(-6) || 'None'})`;
            
            const localStartTime = startDateTime.local().format('YYYY-MM-DD HH:mm');
            this.statusBarItemEl.setAttribute('title', `SolidTime Timer\nDescription: ${this.activeTimeEntry.description || '(None)'}\nProject: ${tooltipProjectName}\nStarted: ${localStartTime}`);

        } else {
            if (this.api && this.settings.selectedOrganizationId) { this.statusBarItemEl.setText('SolidTime'); }
            else { this.statusBarItemEl.setText('SolidTime: Setup needed'); }
            this.statusBarItemEl.removeClass('solidtime-active'); this.statusBarItemEl.removeAttribute('title');
        }
    }

    formatDuration(durationMs: number): string { // Now accepts milliseconds
        if (isNaN(durationMs) || durationMs < 0) {
            return "00:00:00"; // Or handle error appropriately
        }
        // Create a moment duration object
        const momentDuration = moment.duration(durationMs);

        // Format as HH:mm:ss
        // PadStart ensures two digits for hours, minutes, seconds
        const hours = String(Math.floor(momentDuration.asHours())).padStart(2, '0');
        const minutes = String(momentDuration.minutes()).padStart(2, '0');
        const seconds = String(momentDuration.seconds()).padStart(2, '0');

        return `${hours}:${minutes}:${seconds}`;
    }

    async startTimer(options: {
        description: string | null;
        projectId: string | null;
        taskId: string | null;
        tagIds: string[];
        billable: boolean;
    }) {
        if (!this.checkSettingsAndApi()) return;
        if (!this.settings.selectedMemberId) { new Notice("Error: Member ID missing. Please re-select organization in settings."); return; }
        if (this.activeTimeEntry) { new Notice("SolidTime: Please stop the current timer first."); return; }

        const start = moment.utc().format("YYYY-MM-DDTHH:mm:ss") + 'Z';

        const payload: TimeEntryStartPayload = {
            member_id: this.settings.selectedMemberId,
            start: start,
            billable: options.billable,
            project_id: options.projectId,
            task_id: options.taskId,
            description: options.description,
            tags: options.tagIds.length > 0 ? options.tagIds : null,
        };

        try {
            new Notice("SolidTime: Starting timer...");
            // console.log("Start Timer Payload:", JSON.stringify(payload, null, 2)); // Log start payload
            const newEntry = await this.api!.startTimeEntry(this.settings.selectedOrganizationId, payload);
            this.activeTimeEntry = newEntry;
            this.renderStatusBar();
            this.updateSolidTimeView();
            new Notice("SolidTime: Timer started!");
        } catch (error) {
            console.error("SolidTime: Failed to start timer", error);
        }
    }

    async stopCurrentTimer() {
        if (!this.api) { new Notice("SolidTime: API not configured."); return; }
        if (!this.currentUser) {
            try {
                // console.log("SolidTime: Fetching current user before stopping timer...");
                this.currentUser = await this.api.getMe();
            }
            catch (e) {
                console.error("SolidTime: Failed to get current user", e);
                new Notice("Error: Could not verify current user. Cannot stop timer.");
                return;
            }
        }
        if (!this.activeTimeEntry) { new Notice("SolidTime: No timer is currently running."); return; }
        if (!this.activeTimeEntry.organization_id || !this.activeTimeEntry.start) { // Also check if start exists
            console.error("SolidTime: Active time entry is missing required data (org_id or start)!", this.activeTimeEntry);
            new Notice("Error: Cannot stop timer, active entry data is incomplete. Please refresh.", 5000);
            await this.updateStatus(); return;
        }

        const entryToStop = this.activeTimeEntry!;
        const orgIdForEntry = entryToStop.organization_id;

        const end = moment.utc().format("YYYY-MM-DDTHH:mm:ss") + 'Z';

        let correctMemberId: string | null = null;

        try {
            const members = await this.api!.getMembers(orgIdForEntry);
            const currentMembership = members.find(member => member.user_id === this.currentUser!.id);
            if (currentMembership) { correctMemberId = currentMembership.id; }
            else {
                console.error(`SolidTime: Could not find membership for user ${this.currentUser!.id} in organization ${orgIdForEntry}.`);
                new Notice(`Error: Your user was not found in the timer's organization (${orgIdForEntry}). Cannot stop timer.`);
            } // Error handling as before
        } catch (error) {
            console.error(`SolidTime: Failed to fetch members for organization ${orgIdForEntry}`, error);
            new Notice("Error: Failed to fetch organization members. Cannot stop timer.");
            return;
        } // Error handling as before
        if (!correctMemberId) { new Notice("Error: Could not determine correct Member ID. Cannot stop timer."); return; }


        // Construct Payload WITHOUT 'start' field
        const payloadToSend = {
            member_id: correctMemberId,
            // start: entryToStop.start, // REMOVED 'start' field
            end: end,
            billable: entryToStop.billable,
            project_id: entryToStop.project_id,
            task_id: entryToStop.task_id,
            description: entryToStop.description,
            tags: entryToStop.tags,
        };

        // console.log("SolidTime: Attempting to stop timer:");
        // console.log("Org ID:", orgIdForEntry);
        // console.log("Entry ID:", entryToStop.id);
        // console.log("Payload (NO start field, FORMATTED end):", JSON.stringify(payloadToSend, null, 2));

        try {
            new Notice("SolidTime: Stopping timer...");
            this.activeTimeEntry = null;
            this.renderStatusBar();
            this.updateSolidTimeView();
            await this.api!.stopTimeEntry(orgIdForEntry, entryToStop.id, payloadToSend as TimeEntryStopPayload);
            new Notice("SolidTime: Timer stopped!");
        } catch (error) {
            console.error("SolidTime: Failed to stop timer", error);
            await this.updateStatus(); // Revert/refresh
            new Notice("SolidTime: Failed to stop timer. Status refreshed.");
        }
    } // --- End stopCurrentTimer ---


    showCurrentTimerDetails() {
        if (!this.api) { new Notice("SolidTime: Plugin not configured correctly."); return; }
        if (!this.activeTimeEntry || !this.activeTimeEntry.start) { // Also check start time
            new Notice("SolidTime: No timer is currently running or start time is missing.");
            return;
        }

        const startDateTime = moment.utc(this.activeTimeEntry.start);
        if (!startDateTime.isValid) {
            console.error("SolidTime: Failed to parse start time for details:", this.activeTimeEntry.start);
            new Notice("SolidTime: Cannot display details, invalid start time data.");
            return;
        }
        const nowDateTime = moment.utc();
        const duration = nowDateTime.diff(startDateTime);
        const formattedDuration = this.formatDuration(duration);
        const localStartTime = startDateTime.local().format('YYYY-MM-DD HH:mm:ss');
    
        let project = this.projects.find(p => p.id === this.activeTimeEntry?.project_id);
        let task = this.tasks.find(t => t.id === this.activeTimeEntry?.task_id);
        const activeTags = this.tags.filter(t => this.activeTimeEntry?.tags?.includes(t.id));

        let details = `**SolidTime Timer**\n`;
        details += `- Duration: ${formattedDuration}\n`;
        if (project) { details += `- Project: ${project.name}\n`; }
        else if (this.activeTimeEntry.project_id) { details += `- Project: (ID: ...${this.activeTimeEntry.project_id.slice(-6)})\n`; }
        if (task) { details += `- Task: ${task.name}\n`; }
        else if (this.activeTimeEntry.task_id) { details += `- Task: (ID: ...${this.activeTimeEntry.task_id.slice(-6)})\n`; }
        if (this.activeTimeEntry.description) { details += `- Description: ${this.activeTimeEntry.description}\n`; }
        if (activeTags.length > 0) { details += `- Tags: ${activeTags.map(t => t.name).join(', ')}\n`; }
        else if (this.activeTimeEntry.tags?.length > 0) { details += `- Tags: (IDs present, not cached)\n`; }
        details += `- Billable: ${this.activeTimeEntry.billable ? 'Yes' : 'No'}\n`;
        details += `- Started: ${localStartTime}\n`; // Use formatted local time
        details += `- Org ID: ...${this.activeTimeEntry.organization_id.slice(-6)}`;

        new Notice(details.replace(/\n/g, '<br/>'), 15000);

    }

    showStartTimerModal() {
        if (!this.checkSettingsAndApi()) return;
        if (this.projects.length === 0 && this.tags.length === 0 && this.tasks.length === 0) {
            console.log("SolidTime: Data might not be loaded yet for modal.");
            new Notice("Fetching SolidTime data... Please try again shortly.");
            this.loadSolidTimeData(); return;
        }
        new StartTimerModal(this.app, this).open();
    }

}