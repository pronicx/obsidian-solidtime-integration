import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { DateTime, Duration } from 'luxon'; // Import Luxon
import SolidTimePlugin from '../main';
import { ProjectResource } from './types';
import { ProjectSuggestModal, TagSelectionModal } from './modals';

export const SOLIDTIME_VIEW_TYPE = 'solidtime-timer-view';

export class SolidTimeView extends ItemView {
    plugin: SolidTimePlugin;
    private durationIntervalId: number | null = null;

    // Elements
    private descriptionEl: HTMLElement | null = null;
    private projectEl: HTMLElement | null = null;
    private projectColorEl: HTMLElement | null = null;
    private projectNameEl: HTMLElement | null = null; // Need specific ref for project name
    private tagIconEl: HTMLElement | null = null;
    private billableIconEl: HTMLElement | null = null;
    private durationEl: HTMLElement | null = null;
    private playStopButtonEl: HTMLElement | null = null; // Keep ref for button state


    constructor(leaf: WorkspaceLeaf, plugin: SolidTimePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.icon = 'clock';
    }

    getViewType(): string {
        return SOLIDTIME_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'SolidTime Tracker';
    }

    getIcon(): string {
        return 'clock';
    }



    async onOpen() {
        // console.log("SolidTime View: Opened");
        const container = this.containerEl.children[1]; // View content container
        container.empty();
        container.addClass('solidtime-view-container');

        // Initial render
        this.renderViewContent(container as HTMLElement);

        // Update view whenever plugin state changes externally (timer started/stopped elsewhere)
        // We'll trigger this update from main.ts
    }

    async onClose() {
        // console.log("SolidTime View: Closed");
        this.clearDurationInterval();
        // Clean up any other resources or listeners if needed
    }

    // Main function to build/update the view content
    renderViewContent(containerEl: HTMLElement) {
        containerEl.empty(); // Clear previous content

        const timerRunning = !!this.plugin.activeTimeEntry;
        const entry = this.plugin.activeTimeEntry;

        // --- Description (Now Editable) ---
        this.descriptionEl = containerEl.createEl('div', {
            text: entry?.description || (timerRunning ? '(No description)' : 'SolidTime Idle'),
            cls: 'solidtime-view-description'
        });
        this.descriptionEl.setAttribute('title', entry?.description || 'Click to edit');

        // Add click listener for editing
        this.descriptionEl.onclick = () => {
            if (!this.plugin.activeTimeEntry) return; // Only edit running timers
            this.editDescription();
        };

        // --- Row for Project / Icons ---
        const detailsRow = containerEl.createEl('div', { cls: 'solidtime-view-details-row' });

        // Project
        this.projectEl = detailsRow.createEl('div', { cls: 'solidtime-view-project' });
        this.projectColorEl = this.projectEl.createEl('span', { cls: 'solidtime-view-project-color' });
        this.projectNameEl = this.projectEl.createEl('span', { cls: 'solidtime-view-project-name' }); // Store ref

        let project: ProjectResource | undefined | null = null;
        if (entry?.project_id) {
            project = this.plugin.projects.find(p => p.id === entry.project_id);
            this.projectNameEl.setText(project?.name || `(Project ID: ...${entry.project_id.slice(-4)})`);
            this.projectColorEl.style.backgroundColor = project?.color || 'var(--text-muted)';
            this.projectEl.style.display = '';
        } else {
            this.projectNameEl.setText('(No Project)'); // Show placeholder if no project
            this.projectColorEl.style.backgroundColor = 'transparent';
            // Keep the element visible to allow clicking to add a project
            // this.projectEl.style.display = 'none'; // Don't hide
        }
        // Add click listener for project selection
        this.projectEl.onclick = () => {
             if (!this.plugin.activeTimeEntry) return; // Only edit running timers
             this.selectProject();
        };

        // Icons (Tag and Billable - Now Clickable)
        const iconsContainer = detailsRow.createEl('div', { cls: 'solidtime-view-icons' });
        this.tagIconEl = iconsContainer.createEl('span', { cls: 'solidtime-view-icon' });
        setIcon(this.tagIconEl, 'tag');
        const hasTags = !!(entry?.tags && entry.tags.length > 0);
        this.tagIconEl.toggleClass('tag-active', hasTags); // Use specific class for color
        this.tagIconEl.setAttribute('title', `Tags: ${entry?.tags?.length || 0}. Click to edit.`);
        // Add click listener for tags
        this.tagIconEl.onclick = () => {
            if (!this.plugin.activeTimeEntry) return;
            this.selectTags();
        };

        this.billableIconEl = iconsContainer.createEl('span', { cls: 'solidtime-view-icon' });
        setIcon(this.billableIconEl, 'dollar-sign');
        const isBillable = !!entry?.billable;
        this.billableIconEl.toggleClass('billable-active', isBillable); // Use specific class for color
        this.billableIconEl.setAttribute('title', `Billable: ${isBillable ? 'Yes' : 'No'}. Click to toggle.`);
         // Add click listener for billable toggle
        this.billableIconEl.onclick = () => {
            if (!this.plugin.activeTimeEntry) return;
            // Toggle the state and update
            this.plugin.updateActiveTimerDetails({ billable: !isBillable });
        };



        // --- Row for Button / Duration ---
        const controlsRow = containerEl.createEl('div', { cls: 'solidtime-view-controls-row' });

        // Play/Stop Button
        this.playStopButtonEl = controlsRow.createEl('div', { cls: 'solidtime-view-button-container' });
        const button = this.playStopButtonEl.createEl('button', { cls: 'solidtime-view-button' });
        this.durationEl = controlsRow.createEl('div', { text: timerRunning ? '00:00:00' : '--:--:--', cls: 'solidtime-view-duration' });

        if (timerRunning && entry?.start) {
            setIcon(button, 'square'); button.addClass('stop'); button.setAttribute('aria-label', 'Stop Timer');
            button.onclick = () => { this.plugin.stopCurrentTimer(); };
            this.updateDuration(); this.startDurationInterval();
        } else {
            setIcon(button, 'play'); button.addClass('start'); button.setAttribute('aria-label', 'Start Timer');
            button.onclick = () => { this.plugin.showStartTimerModal(); };
            this.clearDurationInterval();
        }
    }

    editDescription() {
        if (!this.descriptionEl || !this.plugin.activeTimeEntry) return;

        const currentDescription = this.plugin.activeTimeEntry.description || '';
        const input = createEl('input', {
            type: 'text',
            value: currentDescription,
            cls: 'solidtime-view-description-input' // Use new CSS class
        });

        // Replace div with input
        this.descriptionEl.replaceWith(input);
        input.focus();
        input.select();

        // Save on blur or Enter
        const save = () => {
            const newDescription = input.value.trim() || null; // Send null if empty
            // Only update if changed
            if (newDescription !== currentDescription) {
                this.plugin.updateActiveTimerDetails({ description: newDescription });
            } else {
                 // If no change, just restore the original display element
                 // Note: updateActiveTimerDetails will eventually call updateView,
                 // but we restore immediately for better UX if no API call needed.
                input.replaceWith(this.descriptionEl!);
                this.descriptionEl!.setText(currentDescription || '(No description)'); // Restore text
            }
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                input.blur(); // Trigger save via blur
            } else if (evt.key === 'Escape') {
                 // Restore original without saving
                 input.replaceWith(this.descriptionEl!);
                 this.descriptionEl!.setText(currentDescription || '(No description)');
            }
        });
    }

    selectProject() {
        if (!this.plugin.activeTimeEntry) return; // Should not happen if called correctly

        new ProjectSuggestModal(this.app, this.plugin.projects, (selectedProject) => {
             // Check if project actually changed
             const currentProjectId = this.plugin.activeTimeEntry?.project_id || null;
             const newProjectId = selectedProject?.id || null;

             if (currentProjectId !== newProjectId) {
                console.log("Changing project to:", selectedProject?.name || "None");
                 this.plugin.updateActiveTimerDetails({ projectId: newProjectId });
                 // Note: The view will fully re-render after the update completes
             }
        }).open();
    }

     // --- Select Tags Logic ---
     selectTags() {
        if (!this.plugin.activeTimeEntry) return;

        const currentTagIds = this.plugin.activeTimeEntry.tags || [];

        new TagSelectionModal(this.app, this.plugin, currentTagIds, (newSelectedIds) => {
            // Check if selection actually changed (simple length check or deep compare)
            const changed = currentTagIds.length !== newSelectedIds.length ||
                           !currentTagIds.every(id => newSelectedIds.includes(id));

            if (changed) {
                console.log("Updating tags to:", newSelectedIds);
                 this.plugin.updateActiveTimerDetails({ tagIds: newSelectedIds });
            } else {
                 console.log("Tag selection unchanged.");
            }
        }).open();
    }


    // --- Duration Update Logic ---

    clearDurationInterval() {
        if (this.durationIntervalId !== null) {
            window.clearInterval(this.durationIntervalId);
            this.durationIntervalId = null;
        }
    }

    startDurationInterval() {
        this.clearDurationInterval(); // Clear any existing interval first
        if (this.plugin.activeTimeEntry) {
            this.durationIntervalId = window.setInterval(() => {
                this.updateDuration();
            }, 1000); // Update every second
        }
    }

    updateDuration() {
        if (!this.plugin.activeTimeEntry || !this.plugin.activeTimeEntry.start || !this.durationEl) {
            this.clearDurationInterval(); // Stop if timer stopped or element is gone
            if (this.durationEl) this.durationEl.setText('--:--:--');
            return;
        }

        const startDateTime = DateTime.fromISO(this.plugin.activeTimeEntry.start);
        if (!startDateTime.isValid) {
            this.durationEl.setText('Invalid Start');
            this.clearDurationInterval();
            return;
        }
        const nowDateTime = DateTime.utc();
        const duration = nowDateTime.diff(startDateTime);

        // Update only the duration text content for efficiency
        this.durationEl.setText(this.plugin.formatDuration(duration));
    }

    // Method called by the plugin to trigger a full refresh
    updateView() {
        // console.log("SolidTime View: Updating view...");
        if(this.containerEl.children[1]) {
            this.renderViewContent(this.containerEl.children[1] as HTMLElement);
        }
    }
}