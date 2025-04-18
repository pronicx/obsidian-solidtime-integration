import { App, Modal, Setting, Notice, SuggestModal } from 'obsidian';
import { ProjectResource, TaskResource, TagResource } from './types'; // Adjust path
import SolidTimePlugin from '../main'; // Adjust path

// --- Suggest Modals for Selection ---

interface ProjectSuggestion extends ProjectResource {
    // Interface might be identical if no extra display logic needed yet
}

export class ProjectSuggestModal extends SuggestModal<ProjectSuggestion> {
    projects: ProjectSuggestion[];
    onChoose: (result: ProjectResource | null) => void; // Allow choosing null (clearing)

    constructor(app: App, projects: ProjectResource[], onChoose: (result: ProjectResource | null) => void) {
        super(app);
        // Add a "None" option
        this.projects = [ { name: '(No Project)', id: '__NONE__' } as ProjectSuggestion, ...projects];
        this.onChoose = onChoose;
        this.setPlaceholder("Select a SolidTime project (or 'No Project')...");
    }

    getSuggestions(query: string): ProjectSuggestion[] {
        const lowerCaseQuery = query.toLowerCase();
        return this.projects.filter(project =>
            project.name.toLowerCase().includes(lowerCaseQuery)
        );
    }

    renderSuggestion(project: ProjectSuggestion, el: HTMLElement) {
        el.createEl('div', { text: project.name });
        // Optionally add client name if available/fetched
    }

    onChooseSuggestion(project: ProjectSuggestion, evt: MouseEvent | KeyboardEvent) {
        if (project.id === '__NONE__') {
            this.onChoose(null);
        } else {
            this.onChoose(project);
        }
    }
}


interface TaskSuggestion extends TaskResource {
     // Add display logic if needed, name is usually enough
}

// Basic Task Suggest Modal (can be enhanced)
export class TaskSuggestModal extends SuggestModal<TaskSuggestion> {
    tasks: TaskSuggestion[];
    onChoose: (result: TaskResource | null) => void;

    constructor(app: App, tasks: TaskResource[], onChoose: (result: TaskResource | null) => void) {
        super(app);
         this.tasks = [ { name: '(No Task)', id: '__NONE__'} as TaskSuggestion, ...tasks];
        this.onChoose = onChoose;
        this.setPlaceholder("Select a task (or 'No Task')...");
    }

    getSuggestions(query: string): TaskSuggestion[] {
        const lowerCaseQuery = query.toLowerCase();
        return this.tasks.filter(task =>
            task.name.toLowerCase().includes(lowerCaseQuery)
        );
    }

    renderSuggestion(task: TaskSuggestion, el: HTMLElement) {
        el.createEl('div', { text: task.name });
    }

    onChooseSuggestion(task: TaskSuggestion, evt: MouseEvent | KeyboardEvent) {
         if (task.id === '__NONE__') {
            this.onChoose(null);
        } else {
            this.onChoose(task);
        }
    }
}


// --- Tag Selection Modal ---
export class TagSelectionModal extends Modal {
    plugin: SolidTimePlugin;
    availableTags: TagResource[];
    selectedTagIds: Set<string>; // Use a Set for efficient add/delete/check
    onSubmit: (selectedIds: string[]) => void;

    newTagName: string = '';

    constructor(
        app: App,
        plugin: SolidTimePlugin,
        currentSelectedIds: string[],
        onSubmit: (selectedIds: string[]) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.availableTags = [...plugin.tags].sort((a, b) => a.name.localeCompare(b.name)); // Get current tags and sort
        this.selectedTagIds = new Set(currentSelectedIds);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('solidtime-tag-modal');
        contentEl.createEl('h2', { text: 'Select Tags' });

        // --- New Tag Input ---
        const newTagSetting = new Setting(contentEl)
            .setName('Create New Tag')
            .setDesc('Enter name and click Create.');

        newTagSetting.addText(text => text
            .setPlaceholder('New tag name...')
            .onChange(value => this.newTagName = value.trim())
        );
        newTagSetting.addButton(button => button
            .setButtonText('Create')
            .setCta()
            .onClick(async () => {
                if (!this.newTagName) {
                    new Notice("Please enter a tag name.");
                    return;
                }
                if (this.availableTags.some(t => t.name.toLowerCase() === this.newTagName.toLowerCase())) {
                     new Notice(`Tag "${this.newTagName}" already exists.`);
                     return;
                }
                try {
                    const newTag = await this.plugin.createTag(this.newTagName);
                    if (newTag) {
                        new Notice(`Tag "${newTag.name}" created.`);
                        this.availableTags.push(newTag);
                        this.availableTags.sort((a, b) => a.name.localeCompare(b.name));
                        this.selectedTagIds.add(newTag.id); // Auto-select newly created tag
                        this.newTagName = ''; // Clear input
                        // Re-render the checkbox list
                        this.renderTagCheckboxes(contentEl.querySelector('.solidtime-tag-checkbox-container')!);
                         // Clear the text input visually (might need reference)
                         const inputEl = newTagSetting.controlEl.querySelector('input');
                         if (inputEl) inputEl.value = '';

                    }
                } catch (error) {
                    console.error("Failed to create tag", error);
                    new Notice("Error creating tag. See console.");
                }
            })
        );

        // --- Existing Tag Checkboxes ---
        const checkboxContainer = contentEl.createDiv({ cls: 'solidtime-tag-checkbox-container' });
        this.renderTagCheckboxes(checkboxContainer);


        // --- Submit Button ---
        new Setting(contentEl)
             .setClass('modal-button-container')
            .addButton(button => button
                .setButtonText('Update Tags')
                .setCta()
                .onClick(() => {
                    this.onSubmit(Array.from(this.selectedTagIds)); // Convert Set back to array
                    this.close();
                })
            );
    }

    renderTagCheckboxes(containerEl: HTMLElement) {
        containerEl.empty(); // Clear previous checkboxes

         if (this.availableTags.length === 0) {
            containerEl.createEl('p', { text: 'No tags available. Create one above.', cls: 'setting-item-description' });
            return;
         }

        this.availableTags.forEach(tag => {
            const setting = new Setting(containerEl)
                .setName(tag.name);

            setting.addToggle(toggle => toggle
                .setValue(this.selectedTagIds.has(tag.id))
                .onChange(value => {
                    if (value) {
                        this.selectedTagIds.add(tag.id);
                    } else {
                        this.selectedTagIds.delete(tag.id);
                    }
                    // console.log("Selected Tags:", Array.from(this.selectedTagIds)); // For debugging
                })
            );
             // Optionally add delete button per tag? Maybe too complex for now.
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


// --- Start Timer Modal ---

export class StartTimerModal extends Modal {
	plugin: SolidTimePlugin;
    description: string = '';
    selectedProject: ProjectResource | null = null;
    selectedTask: TaskResource | null = null;
    selectedTags: TagResource[] = []; // Future: Allow multiple tags
    isBillable: boolean;

    // Data stores from plugin
    availableProjects: ProjectResource[] = [];
    allTasks: TaskResource[] = []; // All tasks for the org
    availableTags: TagResource[] = [];

    // Filtered data for display
    filteredTasks: TaskResource[] = [];

    // HTML Elements for updates
    projectInputElement: HTMLInputElement | null = null;
    taskInputElement: HTMLInputElement | null = null;


	constructor(app: App, plugin: SolidTimePlugin) {
		super(app);
		this.plugin = plugin;
        this.isBillable = plugin.settings.defaultBillable;

        // Get data from the plugin instance
        this.availableProjects = plugin.projects;
        this.allTasks = plugin.tasks;
        this.availableTags = plugin.tags;

        this.filterTasksForSelectedProject(); // Initial filter (no project selected)
	}

    filterTasksForSelectedProject() {
        if (this.selectedProject) {
            // Filter tasks belonging to the selected project and are not done
            this.filteredTasks = this.allTasks.filter(task =>
                task.project_id === this.selectedProject?.id && !task.is_done
            );
        } else {
            // If no project is selected, show no tasks
            this.filteredTasks = [];
        }
        // Clear selected task if its project is no longer selected or if it's not in the filtered list
        if (this.selectedTask && this.selectedTask.project_id !== this.selectedProject?.id) {
            this.selectedTask = null;
        }
        // Update the task input display if it exists
        if (this.taskInputElement) {
            this.taskInputElement.value = this.selectedTask ? this.selectedTask.name : '';
        }
    }

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('solidtime-modal');
		contentEl.createEl('h2', { text: 'Start SolidTime Timer' });

		// Description
		new Setting(contentEl)
			.setName('Description')
			.addText(text => text
				.setPlaceholder('What are you working on?')
                .setValue(this.description) // Set initial value if needed
				.onChange(value => this.description = value));

        // Project Selector
		const projectSetting = new Setting(contentEl)
			.setName('Project')
            .setClass('solidtime-modal-setting'); // Add class for styling if needed

        this.projectInputElement = projectSetting.controlEl.createEl('input', {
            type: 'text',
            attr: { placeholder: 'Click to select project (optional)', readonly: true } // Make it look like a selector
        });
        this.projectInputElement.value = this.selectedProject ? this.selectedProject.name : '';

        this.projectInputElement.addEventListener('click', () => {
            new ProjectSuggestModal(this.app, this.availableProjects, (project) => {
                this.selectedProject = project;
                this.projectInputElement!.value = project ? project.name : ''; // Update input display
                this.selectedTask = null; // Reset task when project changes
                this.filterTasksForSelectedProject(); // Update task list based on project
            }).open();
        });
        projectSetting.controlEl.appendChild(this.projectInputElement);


        // Task Selector (using SuggestModal now)
         const taskSetting = new Setting(contentEl)
			.setName('Task')
            .setClass('solidtime-modal-setting');

        this.taskInputElement = taskSetting.controlEl.createEl('input', {
             type: 'text',
             attr: { placeholder: 'Click to select task (optional)', readonly: true }
        });
        this.taskInputElement.value = this.selectedTask ? this.selectedTask.name : '';

         this.taskInputElement.addEventListener('click', () => {
             if (!this.selectedProject) {
                 new Notice("Please select a project first to see its tasks.");
                 return;
             }
              if (this.filteredTasks.length === 0) {
                  new Notice("No available (non-done) tasks found for this project.");
                  return; // Prevent opening modal if no tasks
             }

             new TaskSuggestModal(this.app, this.filteredTasks, (task) => {
                 this.selectedTask = task;
                 this.taskInputElement!.value = task ? task.name : ''; // Update input display
             }).open();
         });
         taskSetting.controlEl.appendChild(this.taskInputElement);


        // Tags Selector (Future: Multi-select)
        // TODO: Implement TagSuggestModal or similar multi-select UI

        // Billable Toggle
        new Setting(contentEl)
            .setName('Billable')
            .addToggle(toggle => toggle
                .setValue(this.isBillable)
                .onChange(value => this.isBillable = value));

        // Submit Button
		new Setting(contentEl)
            .setClass('modal-button-container') // Optional class for styling
			.addButton(button => button
				.setButtonText('Start Timer')
				.setCta() // Makes it prominent
				.onClick(() => {
					if (!this.plugin.settings.selectedMemberId) {
                        new Notice("Error: Member ID not set. Please re-select organization in settings.");
                        return;
                    }
					this.startTimer();
					this.close();
				}));
	}

	startTimer() {
		this.plugin.startTimer({
            description: this.description || null, // Ensure null if empty
            projectId: this.selectedProject?.id || null,
            taskId: this.selectedTask?.id || null,
            tagIds: this.selectedTags.map(t => t.id), // Use selected tag IDs
            billable: this.isBillable,
        });
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}