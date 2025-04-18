// src/settings.ts (Make sure this is the code in your settings file)

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import SolidTimePlugin from '../main'; // Adjust path if needed
import { SolidTimeApi } from './api'; // Adjust path if needed
import { PersonalMembershipResource, MemberResource } from './types'; // Adjust path if needed

export interface SolidTimeSettings {
	apiKey: string;
	apiBaseUrl: string;
	selectedOrganizationId: string;
	selectedMemberId: string; // Member ID within the selected organization
	statusBarUpdateIntervalSeconds: number;
	autoFetchIntervalMinutes: number;
	defaultBillable: boolean;
}

export const DEFAULT_SETTINGS: SolidTimeSettings = {
	apiKey: '',
	apiBaseUrl: 'https://app.solidtime.io/api', // Default to production
	selectedOrganizationId: '',
	selectedMemberId: '',
	statusBarUpdateIntervalSeconds: 30,
	autoFetchIntervalMinutes: 15,
	defaultBillable: false,
};

export class SolidTimeSettingTab extends PluginSettingTab {
	plugin: SolidTimePlugin;
    private memberships: PersonalMembershipResource[] = [];
    // Removed unused members variable based on refined logic

	constructor(app: App, plugin: SolidTimePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

    async fetchMemberships() {
        this.memberships = [];
        // Only fetch if key and URL are present
        if (this.plugin.settings.apiKey && this.plugin.settings.apiBaseUrl && this.plugin.api) {
            try {
                // Use the already initialized API client if available
                this.memberships = await this.plugin.api.getMemberships();
            } catch (error) {
                console.error("SolidTime: Failed to fetch memberships for settings", error);
                new Notice("Failed to fetch SolidTime organizations. Check API Key/URL or console.");
            }
        } else {
             console.log("SolidTime: Skipping membership fetch, API key/URL missing or API client not ready.");
        }
         // Ensure memberships is always an array
         if (!Array.isArray(this.memberships)) {
            this.memberships = [];
        }
    }

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'SolidTime Integration Settings' });

        // Fetch memberships *before* rendering settings that depend on them
        await this.fetchMemberships();

		new Setting(containerEl)
			.setName('SolidTime API Key')
			.setDesc('Generate an API Token from your SolidTime profile.')
			.addText(text => text
				.setPlaceholder('Enter your API Key')
				.setValue(this.plugin.settings.apiKey) // Use apiKey
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value.trim(); // Use apiKey
					await this.plugin.saveSettings();
                    // Re-fetch memberships when API key changes AFTER saving
                    await this.fetchMemberships();
                    this.display(); // Refresh display to update organization dropdown
				}));

        new Setting(containerEl)
			.setName('SolidTime API Base URL')
			.setDesc('The base URL for the SolidTime API.')
			.addText(text => text
				.setPlaceholder('e.g., https://app.solidtime.io/api')
				.setValue(this.plugin.settings.apiBaseUrl) // Use apiBaseUrl
				.onChange(async (value) => {
					this.plugin.settings.apiBaseUrl = value.trim().replace(/\/$/, ''); // Use apiBaseUrl
					await this.plugin.saveSettings();
                     // Re-fetch memberships when URL changes AFTER saving
                    await this.fetchMemberships();
                    this.display(); // Refresh display
				}));

        const orgSetting = new Setting(containerEl)
            .setName('Active Organization')
            .setDesc('Select the SolidTime organization to use.');

        // Disable dropdown if key/URL missing or no memberships fetched
        const canSelectOrg = this.plugin.settings.apiKey && this.plugin.settings.apiBaseUrl && this.memberships.length > 0;

        if (!this.plugin.settings.apiKey || !this.plugin.settings.apiBaseUrl) {
             orgSetting.setDesc('Enter API Key and Base URL above to load organizations.');
        } else if (this.memberships.length === 0) {
             // Add a button to manually refresh if fetch failed
             orgSetting.setDesc('Could not load organizations. Check API Key/URL or network.');
             orgSetting.addButton(button => button
                .setButtonText('Retry Fetch')
                .onClick(async () => {
                    await this.fetchMemberships();
                    this.display(); // Refresh
                }));
        }

        orgSetting.addDropdown(dropdown => {
            dropdown.addOption('', '-- Select Organization --');
            if (this.memberships.length > 0) {
                this.memberships.forEach(membership => {
                    // Check if organization object exists
                    if (membership.organization) {
                         dropdown.addOption(membership.organization.id, membership.organization.name);
                    } else {
                        console.warn("SolidTime: Membership found without organization details:", membership);
                    }
                });
            }
            dropdown.setValue(this.plugin.settings.selectedOrganizationId);
            dropdown.setDisabled(!canSelectOrg); // Disable if needed
            dropdown.onChange(async (value) => {
                const selectedMembership = this.memberships.find(m => m.organization?.id === value);
                this.plugin.settings.selectedOrganizationId = value;
                // Assumption: The membership ID is the required member_id for API calls within that org
                this.plugin.settings.selectedMemberId = selectedMembership ? selectedMembership.id : '';
                if (!this.plugin.settings.selectedMemberId && value) {
                    console.error("Could not find member_id (membership id) for selected organization:", value);
                    new Notice("Error finding member ID for selected organization. Please re-fetch.");
                }
                await this.plugin.saveSettings();
                // Trigger data refresh in main plugin AFTER saving
                this.plugin.loadSolidTimeData();
            });
        });


        new Setting(containerEl)
			.setName('Default Billable')
			.setDesc('Set the default billable state for new time entries.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.defaultBillable)
				.onChange(async (value) => {
					this.plugin.settings.defaultBillable = value;
					await this.plugin.saveSettings();
				}));

        new Setting(containerEl)
            .setName('Status Bar Update Interval (seconds)')
            .setDesc('How often to check for the current timer status (0 to disable).')
            .addText(text => text
                .setValue(String(this.plugin.settings.statusBarUpdateIntervalSeconds))
                 .onChange(async (value) => {
                    const numberValue = parseInt(value, 10);
                    // Allow 0 to disable
                    if (!isNaN(numberValue) && numberValue >= 0) {
                        this.plugin.settings.statusBarUpdateIntervalSeconds = numberValue;
                        await this.plugin.saveSettings();
                        this.plugin.setupIntervals(); // Re-setup intervals with new value
                    } else {
                         // Optionally reset to default or show validation message
                         new Notice("Please enter a valid number (0 or greater).");
                    }
                }));

        new Setting(containerEl)
            .setName('Data Auto-Fetch Interval (minutes)')
            .setDesc('How often to automatically refresh projects, tasks, and tags (0 to disable).')
            .addText(text => text
                .setValue(String(this.plugin.settings.autoFetchIntervalMinutes))
                .onChange(async (value) => {
                    const numberValue = parseInt(value, 10);
                     // Allow 0 to disable
                    if (!isNaN(numberValue) && numberValue >= 0) {
                        this.plugin.settings.autoFetchIntervalMinutes = numberValue;
                        await this.plugin.saveSettings();
                         this.plugin.setupIntervals(); // Re-setup intervals with new value
                    } else {
                         new Notice("Please enter a valid number (0 or greater).");
                    }
                }));
	}
}