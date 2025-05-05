import { ItemView, WorkspaceLeaf, setIcon, Notice } from 'obsidian';
import { DateTime, Duration } from 'luxon'; // Import Luxon
import SolidTimePlugin from '../main';
import { ProjectResource, TagResource } from './types';
import { ProjectSuggestModal, TagSelectionModal } from './modals';

export const SOLIDTIME_VIEW_TYPE = 'solidtime-timer-view';

export class SolidTimeView extends ItemView {
    plugin: SolidTimePlugin;
    private durationIntervalId: number | null = null;
    private isEditing: boolean = false;

    // Elements
    private descriptionEl: HTMLElement | null = null;
    private projectEl: HTMLElement | null = null;
    private projectColorEl: HTMLElement | null = null;
    private projectNameEl: HTMLElement | null = null; // Need specific ref for project name
    private tagIconEl: HTMLElement | null = null;
    private billableIconEl: HTMLElement | null = null;
    private durationEl: HTMLElement | null = null;
    private playStopButtonEl: HTMLElement | null = null; // Keep ref for button state

    // states for idle configuration
    private pendingDescription: string | null = null;
    private pendingProject: ProjectResource | null = null;


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
        this.isEditing = false;
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
        this.isEditing = false;
    }

    // Main function to build/update the view content
    renderViewContent(containerEl: HTMLElement) {
        if (this.isEditing) {
            // console.log("Skipping renderViewContent because editing is in progress."); // Optional debug log
            return; // Exit early, don't redraw while input is active
        }

        containerEl.empty(); // Clear previous content

        const timerRunning = !!this.plugin.activeTimeEntry;
        const entry = this.plugin.activeTimeEntry;

        // --- Description (Editable in both states (active / idle)) ---
        const currentDesc = timerRunning ? entry?.description : this.pendingDescription;
        this.descriptionEl = containerEl.createEl('div', {
            // Show pending description or placeholder when idle
            text: currentDesc || (timerRunning ? '(No description)' : '(Click to set description)'), // Correct idle placeholder
            cls: 'solidtime-view-description'
        });
        this.descriptionEl.setAttribute('title', currentDesc || 'Click to edit/set description');

        // Assign onclick handler ONCE - the check happens inside editDescription
        this.descriptionEl.onclick = () => {
            this.editDescription();
        };

        // --- Row for Project / Icons ---
        const detailsRow = containerEl.createEl('div', { cls: 'solidtime-view-details-row' });

        // Project (Editable in both states)
        this.projectEl = detailsRow.createEl('div', { cls: 'solidtime-view-project' });
        this.projectColorEl = this.projectEl.createEl('span', { cls: 'solidtime-view-project-color' });
        this.projectNameEl = this.projectEl.createEl('span', { cls: 'solidtime-view-project-name' });

        // Determine which project to display (active or pending)
        const displayProject = timerRunning ? (entry?.project_id ? this.plugin.projects.find(p => p.id === entry.project_id) : null) : this.pendingProject;
        const displayProjectId = timerRunning ? entry?.project_id : this.pendingProject?.id;

        // Apply color/text based on displayProject (using CSS classes)
        if (displayProject?.color) {
            // Set the data attribute if color exists
            this.projectColorEl.setAttribute('data-project-color', displayProject.color);
            // Remove class might not be needed if CSS is only attribute-based now
            this.projectColorEl.removeClass('no-project-color'); // Keep if still used for border toggling
        } else {
            // Remove the data attribute if no color
            this.projectColorEl.removeAttribute('data-project-color');
            // Add class if used for border/default styling
            this.projectColorEl.addClass('no-project-color');
        }

        // Set project name text based on whether the project object was found OR if just the ID exists
        if (displayProject) { this.projectNameEl.setText(displayProject.name); }
        else if (displayProjectId) { this.projectNameEl.setText(`(ID: ...${displayProjectId.slice(-4)})`); }
        else { this.projectNameEl.setText('(Click to select Project)'); }

        // Allow selecting always
        this.projectEl.onclick = () => { this.selectProject(); };


        // Icons (Tag and Billable - Only interactive when running)
        const iconsContainer = detailsRow.createEl('div', { cls: 'solidtime-view-icons' });
        // Tag Icon
        this.tagIconEl = iconsContainer.createEl('span', { cls: 'solidtime-view-icon' });
        setIcon(this.tagIconEl, 'tag');
        const hasTags = timerRunning && !!(entry?.tags && entry.tags.length > 0);
        this.tagIconEl.toggleClass('tag-active', hasTags);
        this.tagIconEl.setAttribute('title', `Tags: ${timerRunning ? (entry?.tags?.length || 0) : 'N/A'}${timerRunning ? '. Click to edit.' : ''}`);
        this.tagIconEl.toggleClass('is-interactive', timerRunning); // Add class only if timer running
        this.tagIconEl.onclick = () => { if (!timerRunning) return; this.selectTags(); };

        // Billable Icon
        this.billableIconEl = iconsContainer.createEl('span', { cls: 'solidtime-view-icon' });
        setIcon(this.billableIconEl, 'dollar-sign');
        const isBillable = timerRunning && !!entry?.billable;
        this.billableIconEl.toggleClass('billable-active', isBillable);
        this.billableIconEl.setAttribute('title', `Billable: ${timerRunning ? (isBillable ? 'Yes' : 'No') : 'N/A'}${timerRunning ? '. Click to toggle.' : ''}`);
        this.billableIconEl.toggleClass('is-interactive', timerRunning); // Add class only if timer running
        this.billableIconEl.onclick = () => { if (!timerRunning) return; this.plugin.updateActiveTimerDetails({ billable: !isBillable }); };

        // --- Row for Button / Duration ---
        const controlsRow = containerEl.createEl('div', { cls: 'solidtime-view-controls-row' });
        this.playStopButtonEl = controlsRow.createEl('div', { cls: 'solidtime-view-button-container' });
        const button = this.playStopButtonEl.createEl('button', { cls: 'solidtime-view-button' });
        this.durationEl = controlsRow.createEl('div', { text: timerRunning ? '00:00:00' : '--:--:--', cls: 'solidtime-view-duration' });

        if (timerRunning && entry?.start) {
            // --- Running State ---
            setIcon(button, 'square'); button.addClass('stop'); button.setAttribute('aria-label', 'Stop Timer');
            button.onclick = () => { this.plugin.stopCurrentTimer(); };
            this.updateDuration(); this.startDurationInterval();
        } else {
            // --- Idle State ---
            setIcon(button, 'play'); button.addClass('start'); button.setAttribute('aria-label', 'Start Timer with current details');
            button.onclick = () => {
                if (!this.pendingDescription) {
                    new Notice("Please enter a description before starting the timer.");
                    // Optionally focus the description input here if desired
                    if (this.descriptionEl) this.editDescription(); // Try to trigger edit mode
                    return; // Stop execution
                }
                // Start timer using pending details from the view's state
                this.plugin.startTimer({
                    description: this.pendingDescription, // Now guaranteed to be non-null
                    projectId: this.pendingProject?.id || null,
                    taskId: null,
                    tagIds: [],
                    billable: this.plugin.settings.defaultBillable
                });
                // Clear pending state after starting
                this.pendingDescription = null;
                this.pendingProject = null;
                // View will refresh automatically via startTimer -> updateStatus -> updateView
            };
            this.clearDurationInterval();
        }
    }

    editDescription() {

        if (this.isEditing) return; // Prevent starting another edit if already editing
        this.isEditing = true;

        const timerRunning = !!this.plugin.activeTimeEntry;
        if (!this.descriptionEl) { this.isEditing = false; return; }

        const currentDescription = (timerRunning ? this.plugin.activeTimeEntry?.description : this.pendingDescription) || '';
        const input = createEl('input', { type: 'text', value: currentDescription, cls: 'solidtime-view-description-input' });

        this.descriptionEl.replaceWith(input);
        input.focus();
        input.select();


        const finishEdit = (saveChanges: boolean) => {
            // --- Reset Editing Flag ---
            this.isEditing = false;
            // --- End Reset Flag ---

            let newDescription: string | null = currentDescription; // Correctly typed here now

            if (saveChanges) {
                newDescription = input.value.trim() || null;
            }

            // Restore the description div first, regardless of save outcome
            // Check if input is still in the DOM (might have been removed by rapid events)
            if (input.parentNode) {
                input.replaceWith(this.descriptionEl!);
            } else if (!this.descriptionEl?.parentNode) {
                // If both are gone (e.g., view closed during edit), try to re-append descriptionEl
                // This might be complex, better to just let the next render handle it if view still exists
                console.warn("Input and description div detached during edit finish.");
                // Attempt to force a re-render might be needed if the view content is now empty
                this.plugin.updateSolidTimeView(); // Trigger a full redraw AFTER resetting the flag
                return; // Avoid further processing on detached node
            }


            // Update text content based on final description
            const finalText = newDescription || (timerRunning ? '(No description)' : '(Click to set description)');
            this.descriptionEl!.setText(finalText);
            this.descriptionEl!.setAttribute('title', newDescription || 'Click to edit/set description');

            // Perform API update or pending state update ONLY if saving changes
            if (saveChanges && newDescription !== currentDescription) {
                if (timerRunning) {
                    this.plugin.updateActiveTimerDetails({ description: newDescription });
                    // No need to manually update text here again, updateActiveTimerDetails -> updateStatus -> updateView will handle it
                } else {
                    this.pendingDescription = newDescription;
                    // Text already updated above
                }
            }
        };

        input.addEventListener('blur', () => finishEdit(true)); // Save on blur
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                finishEdit(true); // Save on Enter
                evt.preventDefault(); // Prevent potential form submission if wrapped
            } else if (evt.key === 'Escape') {
                finishEdit(false); // Restore original on Escape
            }
        });
    }

    selectProject() {
        const timerRunning = !!this.plugin.activeTimeEntry;
        new ProjectSuggestModal(this.app, this.plugin.projects, (selectedProject) => {
            const currentProjectId = (timerRunning ? this.plugin.activeTimeEntry?.project_id : this.pendingProject?.id) || null;
            const newProjectId = selectedProject?.id || null;

            if (currentProjectId !== newProjectId) {
                if (timerRunning) {
                    // Update running timer via API
                    this.plugin.updateActiveTimerDetails({ projectId: newProjectId });
                } else {
                    // Update pending state in the view
                    this.pendingProject = selectedProject;
                    this.projectNameEl?.setText(selectedProject?.name || '(Click to select Project)');
                    if (selectedProject?.color) {
                        this.projectColorEl?.setAttribute('data-project-color', selectedProject.color);
                        this.projectColorEl?.removeClass('no-project-color');
                    } else {
                        this.projectColorEl?.removeAttribute('data-project-color');
                        this.projectColorEl?.addClass('no-project-color');
                    }
                }
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
                // console.log("Updating tags to:", newSelectedIds);
                this.plugin.updateActiveTimerDetails({ tagIds: newSelectedIds });
            } else {
                // console.log("Tag selection unchanged.");
            }
        }).open();
    }

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
        if (this.containerEl.children[1]) {
            this.renderViewContent(this.containerEl.children[1] as HTMLElement);
        }
    }
}